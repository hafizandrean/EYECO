































const fs = require('fs');

async function runTests() {
  const baseUrl = 'http://localhost:8080';
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    console.log('--- TEST 1: Login admin_eyeco ---');
    let res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin_eyeco', password: 'admin123' })
    });
    let data = await res.json();
    assert(data.role === 'superadmin', 'admin_eyeco has superadmin role');
    const saCookie = res.headers.get('set-cookie').split(';')[0];
    
    // Test 8: Admin (we will create one soon) buka /superadmin
    
    console.log('\n--- TEST 2, 3, 4: Create Workspace ---');
    res = await fetch(`${baseUrl}/api/superadmin/workspaces`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Cookie': saCookie 
      },
      body: JSON.stringify({
        name: 'Workspace Jabar',
        company: 'Pemprov Jabar',
        address: 'Gedung Sate',
        description: 'Testing Jabar'
      })
    });
    data = await res.json();
    assert(res.ok, `Create workspace success. Status: ${res.status}`);
    assert(data.workspace && data.workspace.name === 'Workspace Jabar', 'Workspace created and returned');
    assert(data.admin && data.admin.username, 'Admin username generated: ' + (data.admin ? data.admin.username : ''));
    assert(data.adminPasswordPlain, 'Admin password generated: ' + data.adminPasswordPlain);
    
    const adminUser = data.admin.username;
    const adminPass = data.adminPasswordPlain;

    console.log('\n--- TEST 5: Login admin baru ---');
    res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: adminUser, password: adminPass })
    });
    data = await res.json();
    assert(data.role === 'admin', 'Login as new admin success, role is admin');
    const adminCookie = res.headers.get('set-cookie').split(';')[0];
    
    console.log('\n--- TEST 8: Admin buka /superadmin ---');
    res = await fetch(`${baseUrl}/superadmin`, {
      headers: { 'Cookie': adminCookie },
      redirect: 'manual'
    });
    assert(res.status === 403, `Admin access to /superadmin blocked with 403. Actual: ${res.status}`);

    console.log('\n--- TEST 6: Register user ---');
    const userEmail = `user${Date.now()}@test.com`;
    res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test User',
        email: userEmail,
        password: 'password123',
        confirmPassword: 'password123'
      })
    });
    data = await res.json();
    assert(res.ok, 'Register user success');
    const newUsername = data.username;
    
    console.log('\n--- TEST 7: Login user ---');
    res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUsername, password: 'password123' })
    });
    data = await res.json();
    assert(data.role === 'user', 'Login user success, role is user');
    const userCookie = res.headers.get('set-cookie').split(';')[0];

    console.log('\n--- TEST 9: User buka /dashboard ---');
    res = await fetch(`${baseUrl}/dashboard`, {
      headers: { 'Cookie': userCookie },
      redirect: 'manual'
    });
    assert(res.status === 403, `User access to /dashboard blocked with 403. Actual: ${res.status}`);

    console.log('\n--- EXTRA: User buka /dashboard-user ---');
    res = await fetch(`${baseUrl}/dashboard-user`, {
      headers: { 'Cookie': userCookie },
      redirect: 'manual'
    });
    assert(res.status === 200, `User access to /dashboard-user allowed. Actual: ${res.status}`);

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
  } catch (e) {
    console.error('Test script error:', e);
  }
}

runTests();
