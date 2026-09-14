import http from 'http';

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
        port: 3000,
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
        port: 3000,
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

async function runWebRTCTests() {
  console.log('Testing WebRTC Call Signaling endpoints with authenticated users...');

  const ts = Date.now();
  // Register User A
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

  // Register User B
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

  // Check peer online endpoint
  const onlineCheck = await get(`/v1/calls/online/${userB.id}`, tokenA);
  if (!onlineCheck.ok) throw new Error('Online check failed: ' + JSON.stringify(onlineCheck));
  console.log('[PASS] Checked online status for peer');

  // Test signaling offer endpoint
  const callId = `call_${ts}`;
  const offerRes = await post(
    '/v1/calls/offer',
    {
      callId,
      toUserId: userB.id,
      callType: 'video',
      offer: { type: 'offer', sdp: 'v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' },
    },
    tokenA
  );

  if (!offerRes.ok) {
    throw new Error('Offer signal failed: ' + JSON.stringify(offerRes));
  }
  console.log('[PASS] WebRTC video call offer signaled from Caller A to Callee B');

  // Test signaling poll for Callee B
  const pollRes = await get(`/v1/calls/poll?userId=${userB.id}`, tokenB);
  if (!pollRes.ok || !pollRes.incoming) {
    throw new Error('Poll signals failed for Callee B: ' + JSON.stringify(pollRes));
  }
  const receivedSignal = pollRes.incoming;
  if (receivedSignal.callId !== callId || receivedSignal.callType !== 'video') {
    throw new Error('Unexpected signal content: ' + JSON.stringify(receivedSignal));
  }
  console.log('[PASS] Callee B polled and received incoming call offer with matching callId');

  // Test signaling answer endpoint from Callee B to Caller A
  const answerRes = await post(
    '/v1/calls/answer',
    {
      callId,
      toUserId: userA.id,
      answer: { type: 'answer', sdp: 'v=0\r\no=- 54321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n' },
    },
    tokenB
  );
  if (!answerRes.ok) {
    throw new Error('Answer signal failed: ' + JSON.stringify(answerRes));
  }
  console.log('[PASS] WebRTC answer signaled from Callee B to Caller A');

  // Test ICE candidate endpoint
  const iceRes = await post(
    '/v1/calls/ice-candidate',
    {
      callId,
      toUserId: userB.id,
      candidate: { candidate: 'candidate:1 1 UDP 2122260223 127.0.0.1 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 },
    },
    tokenA
  );
  if (!iceRes.ok) {
    throw new Error('ICE candidate signal failed: ' + JSON.stringify(iceRes));
  }
  console.log('[PASS] ICE candidate forwarded successfully');

  // Test end call endpoint
  const endRes = await post(
    '/v1/calls/end',
    {
      callId,
      toUserId: userB.id,
    },
    tokenA
  );
  if (!endRes.ok) {
    throw new Error('End call signal failed: ' + JSON.stringify(endRes));
  }
  console.log('[PASS] WebRTC call termination signaled successfully');

  console.log('====================================================');
  console.log('ALL WEBRTC CALL SIGNALING INTEGRATION TESTS PASSED!');
  console.log('====================================================');
}

runWebRTCTests().catch((err) => {
  console.error('WebRTC test failed:', err);
  process.exit(1);
});
