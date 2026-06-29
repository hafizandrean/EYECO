import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface User {
  id: number;
  username: string;
  passwordHash: string;
  role: 'admin' | 'user';
}

export interface BoundingBox {
  label: string;
  confidence: number;
  x: number; // percentage (0-100)
  y: number; // percentage (0-100)
  w: number; // percentage (0-100)
  h: number; // percentage (0-100)
}

export interface Report {
  id: number;
  userId: number; // Linked user
  location: string;
  timestamp: string; // ISO String
  aiStatus: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi';
  aiConfidence: number | null;
  adminStatus: 'MENUNGGU' | 'VALID' | 'DIABAIKAN';
  image: string;
  identity: string;
  sourceType: string;
  additionalNotes: string;
  adminNotes: string;
  boundingBoxes: BoundingBox[];
}

interface DatabaseSchema {
  users: User[];
  reports: Report[];
}

const DB_PATH = path.join(__dirname, 'db.json');

export class DatabaseManager {
  private static readData(): DatabaseSchema {
    try {
      if (!fs.existsSync(DB_PATH)) {
        const initialSchema: DatabaseSchema = { users: [], reports: [] };
        fs.writeFileSync(DB_PATH, JSON.stringify(initialSchema, null, 2));
        return initialSchema;
      }
      const data = fs.readFileSync(DB_PATH, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      console.error('Error reading database:', err);
      return { users: [], reports: [] };
    }
  }

  private static writeData(data: DatabaseSchema): void {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error writing database:', err);
    }
  }

  // --- HASHING UTILITY ---
  public static hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  // --- USER METHODS ---
  public static findUserByUsername(username: string): User | undefined {
    const db = this.readData();
    return db.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  }

  public static getUserById(id: number): User | undefined {
    const db = this.readData();
    return db.users.find(u => u.id === id);
  }

  public static createUser(username: string, passwordPlain: string, role: 'admin' | 'user'): User | null {
    const db = this.readData();
    
    // Check if user already exists
    const exists = db.users.some(u => u.username.toLowerCase() === username.toLowerCase());
    if (exists) return null;

    const nextId = db.users.length > 0 ? Math.max(...db.users.map(u => u.id)) + 1 : 1;
    
    const newUser: User = {
      id: nextId,
      username: username,
      passwordHash: this.hashPassword(passwordPlain),
      role: role
    };

    db.users.push(newUser);
    this.writeData(db);
    return newUser;
  }

  public static authenticateUser(username: string, passwordPlain: string): User | null {
    const user = this.findUserByUsername(username);
    if (!user) return null;

    const inputHash = this.hashPassword(passwordPlain);
    if (user.passwordHash === inputHash) {
      return user;
    }
    return null;
  }

  // --- REPORT METHODS ---
  public static getAll(): Report[] {
    return this.readData().reports;
  }

  public static getById(id: number): Report | undefined {
    const db = this.readData();
    return db.reports.find((r) => r.id === id);
  }

  public static create(
    report: Omit<Report, 'id' | 'timestamp' | 'adminStatus' | 'adminNotes' | 'userId'>, 
    creatorId: number
  ): Report {
    const db = this.readData();
    const nextId = db.reports.length > 0 ? Math.max(...db.reports.map((r) => r.id)) + 1 : 1;
    
    const newReport: Report = {
      ...report,
      id: nextId,
      userId: creatorId,
      timestamp: new Date().toISOString(),
      adminStatus: 'MENUNGGU',
      adminNotes: '',
    };
    
    db.reports.unshift(newReport); // Insert at the beginning
    this.writeData(db);
    return newReport;
  }

  public static updateVerification(id: number, status: 'VALID' | 'DIABAIKAN' | 'MENUNGGU', notes: string): Report | undefined {
    const db = this.readData();
    const index = db.reports.findIndex((r) => r.id === id);
    if (index === -1) return undefined;
    
    db.reports[index].adminStatus = status;
    db.reports[index].adminNotes = notes;
    this.writeData(db);
    return db.reports[index];
  }

  public static getFiltered(
    filters: {
      timeRange?: string; // 'hari_ini', 'minggu_ini', 'semua'
      date?: string; // YYYY-MM-DD
      aiStatus?: string; // 'TINGGI', 'SEDANG', 'RENDAH', 'Tidak Terindikasi', 'semua'
      adminStatus?: string; // 'MENUNGGU', 'VALID', 'DIABAIKAN', 'semua'
      location?: string;
    },
    userContext: { id: number; role: 'admin' | 'user' }
  ) {
    const db = this.readData();
    let reports = db.reports;

    // Sort by timestamp descending
    reports.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Role restriction: normal user can ONLY see their own reports
    if (userContext.role === 'user') {
      reports = reports.filter((r) => r.userId === userContext.id);
    }

    // Filter by date
    if (filters.date) {
      const targetDate = new Date(filters.date).toDateString();
      reports = reports.filter((r) => new Date(r.timestamp).toDateString() === targetDate);
    } else if (filters.timeRange && filters.timeRange !== 'semua') {
      const now = new Date();
      if (filters.timeRange === 'hari_ini') {
        const today = now.toDateString();
        reports = reports.filter((r) => new Date(r.timestamp).toDateString() === today);
      } else if (filters.timeRange === 'minggu_ini') {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(now.getDate() - 7);
        reports = reports.filter((r) => new Date(r.timestamp).getTime() >= oneWeekAgo.getTime());
      }
    }

    // Filter by aiStatus
    if (filters.aiStatus && filters.aiStatus !== 'semua') {
      reports = reports.filter((r) => r.aiStatus === filters.aiStatus);
    }

    // Filter by adminStatus
    if (filters.adminStatus && filters.adminStatus !== 'semua') {
      reports = reports.filter((r) => r.adminStatus === filters.adminStatus);
    }

    // Filter by location (search)
    if (filters.location && filters.location.trim() !== '') {
      const query = filters.location.toLowerCase();
      reports = reports.filter(
        (r) =>
          r.location.toLowerCase().includes(query) ||
          (r.identity && r.identity.toLowerCase().includes(query))
      );
    }

    return reports;
  }

  public static getStats(userContext?: { id: number; role: 'admin' | 'user' }) {
    const db = this.readData();
    let reports = db.reports;

    // If context is User, only get stats for their own reports
    if (userContext && userContext.role === 'user') {
      reports = reports.filter(r => r.userId === userContext.id);
    }

    const totalReports = reports.length;
    const validCount = reports.filter((r) => r.adminStatus === 'VALID').length;
    const cancelledCount = reports.filter((r) => r.adminStatus === 'DIABAIKAN').length;
    const pendingCount = reports.filter((r) => r.adminStatus === 'MENUNGGU').length;

    // Calculate most vulnerable location (titik paling rawan)
    const locationCounts: Record<string, number> = {};
    reports.forEach((r) => {
      if (r.aiStatus === 'TINGGI' || r.aiStatus === 'SEDANG') {
        locationCounts[r.location] = (locationCounts[r.location] || 0) + 1;
      }
    });

    let mostVulnerableLocation = '-';
    let maxCount = 0;
    Object.entries(locationCounts).forEach(([loc, count]) => {
      if (count > maxCount) {
        maxCount = count;
        mostVulnerableLocation = loc;
      }
    });

    if (totalReports > 0 && mostVulnerableLocation === '-') {
      // If we have reports but no high/medium threat, pick the most frequent location overall
      const allLocationCounts: Record<string, number> = {};
      reports.forEach((r) => {
        allLocationCounts[r.location] = (allLocationCounts[r.location] || 0) + 1;
      });
      let maxAllCount = 0;
      Object.entries(allLocationCounts).forEach(([loc, count]) => {
        if (count > maxAllCount) {
          maxAllCount = count;
          mostVulnerableLocation = loc;
        }
      });
    }

    return {
      total: totalReports,
      mostVulnerable: mostVulnerableLocation,
      valid: validCount,
      cancelled: cancelledCount,
      pending: pendingCount,
    };
  }
}
