const fs = require('fs');
const path = require('path');

const viewsDir = path.join(__dirname, 'public', 'views');

const navbarHTML = `
  <div class="bg-blobs">
    <div class="blob blob-1"></div>
    <div class="blob blob-2"></div>
  </div>
  <nav class="navbar">
    <a href="dashboard.html" class="logo">
      <i data-lucide="eye"></i> EYECO
    </a>
    <div class="nav-links">
      <a href="dashboard.html">Dashboard</a>
      <a href="select-workspace.html">Workspaces</a>
    </div>
    <div class="profile-menu">
      <div class="profile-btn">
        <div class="profile-avatar">U</div>
        <span>User</span>
        <i data-lucide="chevron-down"></i>
      </div>
      <div class="dropdown-content">
        <a href="profile.html"><i data-lucide="user"></i> Profile</a>
        <a href="settings.html"><i data-lucide="settings"></i> Settings</a>
        <a href="login.html"><i data-lucide="log-out"></i> Logout</a>
      </div>
    </div>
  </nav>
`;

function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  
  // 1. Remove internal styles completely
  content = content.replace(/<style>[\s\S]*?<\/style>/g, '<link rel="stylesheet" href="../css/style.css">');
  
  // 2. Remove sidebars completely
  content = content.replace(/<aside[\s\S]*?<\/aside>/g, '');
  
  // 3. Remove old navbars
  content = content.replace(/<nav[^>]*>[\s\S]*?<\/nav>/g, '');
  content = content.replace(/<div class="navbar"[^>]*>[\s\S]*?<\/div>\s*<!-- End Navbar -->/g, ''); // Try to catch div navbars
  
  // 4. Inject standard navbar & blobs after <body>
  // Only inject if it's not a login/register page
  const fileName = path.basename(filePath);
  if (!fileName.includes('login') && !fileName.includes('register')) {
      content = content.replace(/<body>/, `<body>\n${navbarHTML}`);
  } else {
      content = content.replace(/<body>/, `<body>\n  <div class="bg-blobs"><div class="blob blob-1"></div><div class="blob blob-2"></div></div>`);
  }

  // 5. Replace card classes to match new design
  content = content.replace(/class="card"/g, 'class="glass-card"');
  
  fs.writeFileSync(filePath, content);
  console.log(`Processed ${fileName}`);
}

const files = fs.readdirSync(viewsDir);
files.forEach(file => {
  if (file.endsWith('.html')) {
    processFile(path.join(viewsDir, file));
  }
});
