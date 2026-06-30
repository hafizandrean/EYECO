// formatter.js - Format Data Utilitas Klien
export const Formatter = {
  // Format tanggal ISO string -> "30 Jun 2026, 09:26 WIB"
  formatDate(isoString) {
    if (!isoString) return '-';
    try {
      const date = new Date(isoString);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
      const day = date.getDate();
      const month = months[date.getMonth()];
      const year = date.getFullYear();
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${day} ${month} ${year}, ${hours}:${minutes} WIB`;
    } catch (err) {
      return '-';
    }
  },

  // Format ke waktu singkat -> "09:26"
  formatTime(isoString) {
    if (!isoString) return '--:--';
    try {
      const date = new Date(isoString);
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    } catch (err) {
      return '--:--';
    }
  },

  // Format nilai pecahan desimal -> Persentase (e.g. 0.89 -> "89%")
  formatPercentage(val) {
    if (val === undefined || val === null) return '-';
    if (val <= 1) {
      return `${Math.round(val * 100)}%`;
    }
    return `${Math.round(val)}%`;
  }
};
