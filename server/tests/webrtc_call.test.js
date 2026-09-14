import http from 'node:http';
import express from 'express';
import { WebSocket } from 'ws';
import { initDatabase } from '../src/database.js';
import { router as apiRouter } from '../src/api.js';
import { setupSignaling } from '../src/signaling.js';

let serverPort = 0;
let serverInstance = null;

function post(path, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort,
        path,
        method: 'POST',
        headers,
      },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            resolve({ raw: buf, statusCode: res.statusCode });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort,
        path,
        method: 'GET',
        headers,
      },
      (res) => {
        let buf = '';
        res.on('data', (d) => (buf += d));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf));
          } catch (e) {
            resolve({ raw: buf, statusCode: res.statusCode });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function startTestServer() {
  return new Promise((resolve, reject) => {
    try {
      initDatabase();
      const app = express();
      app.use(express.json());
      app.use(apiRouter);

      const httpServer = http.createServer(app);
      setupSignaling(httpServer);

      httpServer.listen(0, '127.0.0.1', () => {
        const address = httpServer.address();
        serverPort = address.port;
        serverInstance = httpServer;
        console.log(`[Test Setup] In-process test server running on 127.0.0.1:${serverPort}`);
        resolve();
      });

      httpServer.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

async function runWebRTCTests() {
  console.log('====================================================');
  console.log('  STARTING WEBRTC & SIGNALING INTEGRATION TESTS');
  console.log('====================================================');

  await startTestServer();

  const ts = Date.now();

  // 1. Health check
  const health = await get('/api/health');
  if (health.status !== 'ok') {
    throw new Error('Health check failed: ' + JSON.stringify(health));
  }
  console.log('[PASS] API Server health OK');

  // 2. Register Caller A
  const regA = await post('/v1/auth/register', {
    username: `caller_${ts}`,
    displayName: 'Caller A',
    password: 'Password123!',
    publicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0fakePublicKeyCallerA',
  });
  if (!regA.token) throw new Error('Caller A registration failed: ' + JSON.stringify(regA));
  const tokenA = regA.token;
  const userA = regA.user;
  console.log('[PASS] Registered Caller A:', userA.username);

  // 3. Register Callee B
  const regB = await post('/v1/auth/register', {
    username: `callee_${ts}`,
    displayName: 'Callee B',
    password: 'Password123!',
    publicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0fakePublicKeyCalleeB',
  });
  if (!regB.token) throw new Error('Callee B registration failed: ' + JSON.stringify(regB));
  const tokenB = regB.token;
  const userB = regB.user;
  console.log('[PASS] Registered Callee B:', userB.username);

  // 4. Test WebSocket real-time connection & auth
  const wsUrl = `ws://127.0.0.1:${serverPort}/ws`;
  const wsA = new WebSocket(wsUrl);
  const wsB = new WebSocket(wsUrl);

  await Promise.all([
    new Promise((res) => wsA.on('open', res)),
    new Promise((res) => wsB.on('open', res)),
  ]);
  console.log('[PASS] WebSockets connected for Caller A and Callee B');

  // Authenticate sockets
  wsA.send(JSON.stringify({ type: 'auth', userId: userA.id }));
  wsB.send(JSON.stringify({ type: 'auth', userId: userB.id }));

  await new Promise((r) => setTimeout(r, 100));

  // Check peer online endpoint
  const onlineCheck = await get(`/v1/calls/online/${userB.id}`, tokenA);
  if (!onlineCheck.ok || !onlineCheck.online) {
    throw new Error('Online check failed: ' + JSON.stringify(onlineCheck));
  }
  console.log('[PASS] Checked online status for peer over WebSocket');

  // 5. Test real-time call offer through WebSocket from A to B
  const callId = `call_${ts}`;
  const wsOfferPromise = new Promise((resolve) => {
    wsB.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'incoming_call' && msg.callId === callId) {
          resolve(msg);
        }
      } catch (e) {}
    });
  });

  wsA.send(
    JSON.stringify({
      type: 'call_offer',
      callId,
      fromUser: userA,
      toUserId: userB.id,
      callType: 'video',
      offer: { type: 'offer', sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' },
    })
  );

  const incomingOffer = await Promise.race([
    wsOfferPromise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('WS Offer timeout')), 2500)),
  ]);
  if (!incomingOffer || incomingOffer.callId !== callId) {
    throw new Error('WebSocket incoming_call failed: ' + JSON.stringify(incomingOffer));
  }
  console.log('[PASS] WebSocket real-time incoming_call received by Callee B');

  // 6. Test real-time call answer through WebSocket from B to A
  const wsAnswerPromise = new Promise((resolve) => {
    wsA.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'call_answered' && msg.callId === callId) {
          resolve(msg);
        }
      } catch (e) {}
    });
  });

  wsB.send(
    JSON.stringify({
      type: 'call_answer',
      callId,
      toUserId: userA.id,
      answer: { type: 'answer', sdp: 'v=0\r\no=- 54321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' },
    })
  );

  const answeredCall = await Promise.race([
    wsAnswerPromise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('WS Answer timeout')), 2500)),
  ]);
  if (!answeredCall || answeredCall.callId !== callId) {
    throw new Error('WebSocket call_answered failed: ' + JSON.stringify(answeredCall));
  }
  console.log('[PASS] WebSocket real-time call_answered received by Caller A');

  // 7. Test REST Signaling Fallback (Offer -> Poll -> Answer -> Candidate -> End)
  const restCallId = `rest_call_${ts}`;
  const restOffer = await post(
    '/v1/calls/offer',
    {
      callId: restCallId,
      toUserId: userB.id,
      callType: 'audio',
      offer: { type: 'offer', sdp: 'dummy-rest-sdp' },
    },
    tokenA
  );
  if (!restOffer.ok) throw new Error('REST offer failed: ' + JSON.stringify(restOffer));
  console.log('[PASS] REST Signaling: offer submitted');

  const pollRes = await get(`/v1/calls/poll?userId=${userB.id}`, tokenB);
  if (!pollRes.ok || !pollRes.incoming || pollRes.incoming.callId !== restCallId) {
    throw new Error('REST poll failed: ' + JSON.stringify(pollRes));
  }
  console.log('[PASS] REST Signaling: polled incoming offer successfully');

  const restAnswer = await post(
    '/v1/calls/answer',
    {
      callId: restCallId,
      toUserId: userA.id,
      answer: { type: 'answer', sdp: 'dummy-rest-answer-sdp' },
    },
    tokenB
  );
  if (!restAnswer.ok) throw new Error('REST answer failed: ' + JSON.stringify(restAnswer));
  console.log('[PASS] REST Signaling: answer submitted');

  const candidateRes = await post(
    '/v1/calls/candidate',
    {
      callId: restCallId,
      toUserId: userB.id,
      candidate: { candidate: 'dummy-candidate' },
    },
    tokenA
  );
  if (!candidateRes.ok) throw new Error('REST candidate failed: ' + JSON.stringify(candidateRes));
  console.log('[PASS] REST Signaling: ICE candidate recorded');

  const endRes = await post(
    '/v1/calls/end',
    {
      callId: restCallId,
      toUserId: userB.id,
    },
    tokenA
  );
  if (!endRes.ok) throw new Error('REST end call failed: ' + JSON.stringify(endRes));
  console.log('[PASS] REST Signaling: call terminated');

  // Clean up WebSockets & Server
  wsA.close();
  wsB.close();

  if (serverInstance) {
    await new Promise((res) => serverInstance.close(res));
  }

  console.log('====================================================');
  console.log('  ALL WEBRTC & SIGNALING TESTS PASSED SUCCESSFULLY! ');
  console.log('====================================================');
}

runWebRTCTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('WebRTC test failed:', err);
    if (serverInstance) {
      serverInstance.close(() => process.exit(1));
    } else {
      process.exit(1);
    }
  });
