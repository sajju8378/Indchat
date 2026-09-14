import { WebSocketServer, WebSocket } from 'ws';

// In-memory mapping of active connected users: userId -> WebSocket
const activeSockets = new Map();

// In-memory active calls queue for fast routing & REST polling fallback
// callId -> { callId, fromUser, toUserId, callType, offer, answer, candidates: [], status: 'ringing'|'connected'|'ended'|'rejected', updatedAt: timestamp }
const activeCalls = new Map();

// Clean up stale calls older than 3 minutes
setInterval(() => {
  const now = Date.now();
  for (const [callId, call] of activeCalls.entries()) {
    if (now - call.updatedAt > 180000 || call.status === 'ended' || call.status === 'rejected') {
      activeCalls.delete(callId);
    }
  }
}, 30000);

export function getActiveCalls() {
  return activeCalls;
}

export function isUserOnline(userId) {
  const ws = activeSockets.get(userId);
  return !!(ws && ws.readyState === WebSocket.OPEN);
}

export function setupSignaling(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/ws' || url.pathname === '/ws/') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws) => {
    let authenticatedUserId = null;

    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());

        switch (msg.type) {
          case 'auth': {
            if (msg.userId) {
              authenticatedUserId = msg.userId;
              activeSockets.set(msg.userId, ws);
              safeSend(ws, {
                type: 'auth_ok',
                userId: msg.userId,
                timestamp: Date.now(),
              });
            }
            break;
          }

          case 'ping': {
            safeSend(ws, { type: 'pong', timestamp: Date.now() });
            break;
          }

          case 'call_offer': {
            const { callId, toUserId, fromUser, callType, offer } = msg;
            if (!toUserId || !offer) return;

            // Save to activeCalls
            activeCalls.set(callId, {
              callId,
              fromUser,
              toUserId,
              callType: callType || 'audio',
              offer,
              answer: null,
              candidates: [],
              status: 'ringing',
              updatedAt: Date.now(),
            });

            // Route to target peer if connected via WebSocket
            const peerWs = activeSockets.get(toUserId);
            if (peerWs && peerWs.readyState === WebSocket.OPEN) {
              safeSend(peerWs, {
                type: 'incoming_call',
                callId,
                fromUser,
                callType: callType || 'audio',
                offer,
                timestamp: Date.now(),
              });
            } else {
              // Target is not on websocket; notify caller
              safeSend(ws, {
                type: 'user_unavailable',
                callId,
                toUserId,
                reason: 'Target user is currently offline or unreachable.',
              });
            }
            break;
          }

          case 'call_answer': {
            const { callId, toUserId, answer } = msg;
            const call = activeCalls.get(callId);
            if (call) {
              call.answer = answer;
              call.status = 'connected';
              call.updatedAt = Date.now();
            }

            const callerWs = activeSockets.get(toUserId);
            if (callerWs && callerWs.readyState === WebSocket.OPEN) {
              safeSend(callerWs, {
                type: 'call_answered',
                callId,
                answer,
                timestamp: Date.now(),
              });
            }
            break;
          }

          case 'ice_candidate': {
            const { callId, toUserId, candidate } = msg;
            if (!toUserId || !candidate) return;

            const targetWs = activeSockets.get(toUserId);
            if (targetWs && targetWs.readyState === WebSocket.OPEN) {
              safeSend(targetWs, {
                type: 'ice_candidate',
                callId,
                candidate,
                timestamp: Date.now(),
              });
            } else {
              // Buffer candidate in active call
              const call = activeCalls.get(callId);
              if (call) {
                call.candidates.push({ toUserId, candidate });
              }
            }
            break;
          }

          case 'call_reject': {
            const { callId, toUserId, reason } = msg;
            const call = activeCalls.get(callId);
            if (call) {
              call.status = 'rejected';
              call.updatedAt = Date.now();
            }

            const callerWs = activeSockets.get(toUserId);
            if (callerWs && callerWs.readyState === WebSocket.OPEN) {
              safeSend(callerWs, {
                type: 'call_rejected',
                callId,
                reason: reason || 'Call declined',
                timestamp: Date.now(),
              });
            }
            break;
          }

          case 'call_end': {
            const { callId, toUserId } = msg;
            const call = activeCalls.get(callId);
            if (call) {
              call.status = 'ended';
              call.updatedAt = Date.now();
            }

            const otherWs = activeSockets.get(toUserId);
            if (otherWs && otherWs.readyState === WebSocket.OPEN) {
              safeSend(otherWs, {
                type: 'call_ended',
                callId,
                timestamp: Date.now(),
              });
            }
            break;
          }

          default:
            break;
        }
      } catch (err) {
        console.error('[Signaling] error processing message:', err);
      }
    });

    ws.on('close', () => {
      if (authenticatedUserId && activeSockets.get(authenticatedUserId) === ws) {
        activeSockets.delete(authenticatedUserId);
      }
    });

    ws.on('error', (err) => {
      console.warn('[Signaling] socket error:', err.message);
    });
  });

  // Heartbeat ping every 25 seconds
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 25000);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  return wss;
}

function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch (e) {
      console.error('[Signaling] safeSend failed:', e);
    }
  }
}
