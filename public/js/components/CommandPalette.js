// CommandPalette.js - Komponen Pintasan Keyboard & Navigasi Cepat (Ctrl + K)
import { Router } from '../core/router.js';
import { AppState } from '../core/state.js';
import { AuthService } from '../services/authService.js';
import { ReportService } from '../services/reportService.js';

export class CommandPalette {
  constructor() {
    this.modal = null;
    this.input = null;
    this.list = null;
    this.selectedIndex = 0;
    this.commands = [];

    // Keyboard binding
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  init() {
    this.modal = document.getElementById('command-palette-modal');
    if (!this.modal) return;

    this.input = this.modal.querySelector('.cmd-input');
    this.list = this.modal.querySelector('.cmd-list');

    // Close button or click outside
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.close();
      }
    });

    // Close on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal.classList.contains('active')) {
        this.close();
      }
    });

    // Event listeners inside the input
    this.input.addEventListener('input', () => this.filterCommands());
    this.input.addEventListener('keydown', (e) => this.handleKeyNavigation(e));

    // Populate static commands list based on role
    this.setupCommands();
  }

  setupCommands() {
    const isAdmin = AppState.get('user')?.role === 'admin';

    this.commands = [];

    if (isAdmin) {
      this.commands.push({
        title: 'Buka Dashboard Pemantauan',
        subtitle: 'Lihat grid CCTV dan Live Alerts secara real-time',
        shortcut: '↵',
        action: () => Router.navigate('/dashboard')
      });
      this.commands.push({
        title: 'Buka Daftar Laporan',
        subtitle: 'Cari logs deteksi lingkungan dan validasi admin',
        shortcut: '↵',
        action: () => Router.navigate('/dashboard/laporan')
      });
      this.commands.push({
        title: 'Ekspor Seluruh Laporan (CSV)',
        subtitle: 'Unduh file CSV riwayat aktivitas lingkungan',
        shortcut: '↵',
        action: () => ReportService.exportCSV()
      });
    }

    this.commands.push({
      title: 'Upload Bukti Baru',
      subtitle: 'Kirim gambar/video pemantauan untuk dianalisis AI',
      shortcut: '↵',
      action: () => Router.navigate('/dashboard/upload')
    });

    this.commands.push({
      title: 'Ubah Tema Sistem',
      subtitle: 'Toggle antara Mode Gelap (Dark) dan Terang (Light)',
      shortcut: '↵',
      action: () => {
        const currentTheme = AppState.get('theme');
        AppState.set('theme', currentTheme === 'dark' ? 'light' : 'dark');
      }
    });

    this.commands.push({
      title: 'Keluar Sesi (Logout)',
      subtitle: 'Akhiri sesi pemantauan saat ini secara aman',
      shortcut: 'Esc',
      action: () => AuthService.logout()
    });
  }

  toggle() {
    if (!this.modal) return;
    if (this.modal.classList.contains('active')) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    this.setupCommands(); // Refresh commands to match login roles
    this.modal.classList.add('active');
    this.input.value = '';
    this.selectedIndex = 0;
    this.filterCommands();
    setTimeout(() => this.input.focus(), 50);
  }

  close() {
    if (this.modal) {
      this.modal.classList.remove('active');
      this.input.blur();
    }
  }

  filterCommands() {
    const searchVal = this.input.value.toLowerCase().trim();
    const filtered = this.commands.filter(cmd => 
      cmd.title.toLowerCase().includes(searchVal) || 
      cmd.subtitle.toLowerCase().includes(searchVal)
    );

    this.renderCommands(filtered);
  }

  renderCommands(cmds) {
    this.list.innerHTML = '';
    
    if (cmds.length === 0) {
      this.list.innerHTML = `
        <div class="cmd-empty">
          <i data-lucide="search-code" style="width: 24px; height: 24px; margin-bottom: 8px;"></i>
          <p>Perintah tidak ditemukan</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    cmds.forEach((cmd, idx) => {
      const item = document.createElement('div');
      item.className = `cmd-item ${idx === this.selectedIndex ? 'selected' : ''}`;
      item.innerHTML = `
        <div class="cmd-item-info">
          <div class="cmd-item-title">${cmd.title}</div>
          <div class="cmd-item-subtitle">${cmd.subtitle}</div>
        </div>
        <kbd class="cmd-kbd">${cmd.shortcut}</kbd>
      `;

      item.addEventListener('click', () => {
        cmd.action();
        this.close();
      });

      this.list.appendChild(item);
    });
  }

  handleKeyNavigation(e) {
    const items = this.list.querySelectorAll('.cmd-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % items.length;
      this.updateSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + items.length) % items.length;
      this.updateSelection(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selectedItem = items[this.selectedIndex];
      if (selectedItem) {
        selectedItem.click();
      }
    }
  }

  updateSelection(items) {
    items.forEach((item, idx) => {
      if (idx === this.selectedIndex) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('selected');
      }
    });
  }
}
export const GlobalCommandPalette = new CommandPalette();
