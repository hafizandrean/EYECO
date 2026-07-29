import crypto from 'crypto';

function sign(method: string, path: string, body: string, t: string, accessId: string, accessSecret: string, token: string = '') {
  const contentHash = crypto.createHash('sha256').update(body).digest('hex').toLowerCase();
  // stringToSign = HTTPMethod + \n + Content-SHA256 + \n + Headers + \n + Url
  const stringToSign = `${method}\n${contentHash}\n\n${path}`;
  const signStr = `${accessId}${token}${t}${stringToSign}`;
  return crypto.createHmac('sha256', accessSecret).update(signStr).digest('hex').toUpperCase();
}

async function test() {
  const accessId = 'vhxcdfe5q7d5vr4wsgs3';
  const accessSecret = '0757b40d43884b83952b3b306814fba9';
  const t = String(Date.now());
  const method = 'GET';
  const path = '/v1.0/token?grant_type=1';
  
  const sig = sign(method, path, '', t, accessId, accessSecret);
  console.log('Sig:', sig, 't:', t);

  const res = await fetch(`https://openapi.tuyaus.com${path}`, {
    method: 'GET',
    headers: {
      client_id: accessId,
      sign: sig,
      t,
      sign_method: 'HMAC-SHA256',
      nonce: '',
    },
  });

  const data = await res.json();
  console.log(data);
}

test();
