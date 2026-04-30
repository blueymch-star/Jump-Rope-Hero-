/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft,
  Calendar, 
  Trophy, 
  Users, 
  Settings, 
  Plus, 
  ChevronRight, 
  Download, 
  FileText,
  Trash2, 
  PlusCircle, 
  BarChart3,
  Search,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  LogOut,
  LogIn,
  Medal,
  Clock,
  Save,
  Globe,
  Camera,
  Scan,
  Star,
  ClipboardList,
  History,
  RotateCcw,
  Edit2,
  X,
  CheckCircle,
  Layout,
  List,
  User as UserIcon
} from 'lucide-react';
import { 
  auth, 
  db, 
  googleProvider,
  handleFirestoreError as handleFSLocalError
} from './lib/firebase';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  orderBy, 
  limit, 
  increment,
  setDoc,
  getDoc,
  writeBatch,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { format } from 'date-fns';
import { GradeLevel, Class, Student, JumpRecord } from './types';
import { useOpenCV } from './hooks/useOpenCV';
import { cn } from './lib/utils';

// --- Helpers ---

const getGradeLevelFromName = (name: string): GradeLevel => {
  // Check for the first occurance of a number 1-6
  const numMatch = name.match(/[1-6]/);
  if (numMatch) {
    const num = parseInt(numMatch[0]);
    if (num === 1 || num === 2) return 'Low';
    if (num === 3 || num === 4) return 'Middle';
    if (num === 5 || num === 6) return 'High';
  }
  // Check for Chinese numerals
  if (name.includes('一') || name.includes('二')) return 'Low';
  if (name.includes('三') || name.includes('四')) return 'Middle';
  if (name.includes('五') || name.includes('六')) return 'High';
  return 'Low';
};

const getClassSortValue = (name: string): number => {
  const gradeMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 };
  const suffixMap: Record<string, number> = { '甲': 1, '乙': 2, '丙': 3, '丁': 4, '戊': 5, '己': 6, '庚': 7, '辛': 8, '壬': 9, '癸': 10 };
  
  let score = 0;
  
  // Extract Grade
  const gradeMatch = name.match(/([一二三四五六1-6])年/);
  if (gradeMatch) {
    score += (gradeMap[gradeMatch[1]] || 0) * 1000;
  }
  
  // Extract Class
  const suffixMatch = name.match(/年([甲乙丙丁戊己庚辛壬癸])/);
  if (suffixMatch) {
    score += (suffixMap[suffixMatch[1]] || 0) * 10;
  } else {
    // Check for "1班", "01班" etc
    const numMatch = name.match(/年?(\d+)/);
    if (numMatch) {
      // If it's something like "4年1班", we want the "1"
      // But gradeMatch already matched "4年", so we look for what's after that
      const remaining = name.split(gradeMatch[0])[1] || '';
      const subNum = remaining.match(/(\d+)/);
      if (subNum) {
        score += parseInt(subNum[1]) * 10;
      }
    }
  }
  
  return score || 9999; // Fallback for unknown formats
};

// --- Taipei 101 Constants ---
const TOWER_HEIGHT = 50800; // cm
const FLOOR_COUNT = 20;
const FLOOR_SIZE = TOWER_HEIGHT / FLOOR_COUNT; // 2540 cm

const getTowerStats = (totalJumps: number) => {
  const towerCount = Math.floor(totalJumps / TOWER_HEIGHT);
  const remainingJumps = totalJumps % TOWER_HEIGHT;
  const currentFloor = Math.floor(remainingJumps / FLOOR_SIZE) + 1;
  const floorProgress = (remainingJumps % FLOOR_SIZE) / FLOOR_SIZE * 100;
  return { towerCount, currentFloor, floorProgress, remainingJumps };
};

const getTowerStyles = (count: number) => {
  // Count starts from 0 for the first tower
  if (count === 0) return 'from-teal-400 via-emerald-500 to-indigo-600 shadow-emerald-500/30';
  if (count === 1) return 'from-amber-700 via-yellow-600 to-amber-500 shadow-amber-600/30'; // Bronze
  if (count === 2) return 'from-slate-400 via-slate-300 to-slate-100 shadow-white/40 drop-shadow-md'; // Silver
  if (count === 3) return 'from-yellow-600 via-yellow-500 to-yellow-300 shadow-yellow-400/50 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]'; // Gold
  return 'from-red-700 via-red-500 to-rose-400 shadow-red-500/60 drop-shadow-[0_0_15px_rgba(239,68,68,0.9)] animate-pulse'; // Awakened Red
};

const getTierName = (count: number) => {
  if (count === 0) return '經典玻璃';
  if (count === 1) return '青銅級';
  if (count === 2) return '白銀級';
  if (count === 3) return '耀眼黃金';
  return '覺醒 101';
};

const getTierColorClass = (count: number) => {
    if (count === 0) return 'text-teal-400';
    if (count === 1) return 'text-amber-700';
    if (count === 2) return 'text-slate-300 drop-shadow-md';
    if (count === 3) return 'text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)]';
    return 'text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.9)] animate-pulse';
};

const Taipei101Visual = ({ jumps, towerCount }: { jumps: number, towerCount: number }) => {
  const currentFloorIndex = Math.floor(jumps / FLOOR_SIZE);
  const floorProgress = (jumps % FLOOR_SIZE) / FLOOR_SIZE * 100;
  const styleClass = getTowerStyles(towerCount);

  return (
    <div className="w-16 h-48 bg-slate-900/60 rounded-xl border border-white/10 p-1 flex flex-col-reverse gap-0.5 relative overflow-hidden ring-1 ring-white/5 group-hover:ring-teal-500/30 transition-all">
      {Array.from({ length: FLOOR_COUNT }).map((_, i) => (
        <div key={i} className="flex-1 bg-white/5 rounded-sm relative overflow-hidden">
          {i < currentFloorIndex && (
            <div className={cn("w-full h-full bg-gradient-to-t", styleClass)} />
          )}
          {i === currentFloorIndex && (
            <motion.div 
               initial={{ height: 0 }}
               animate={{ height: `${floorProgress}%` }}
               className={cn("w-full absolute bottom-0 left-0 bg-gradient-to-t", styleClass)}
            />
          )}
        </div>
      ))}
      <div className="absolute top-1 right-1 px-1 py-0.5 bg-black/40 rounded backdrop-blur-sm border border-white/10">
         <span className="text-[8px] font-black text-white italic leading-none">101</span>
      </div>
    </div>
  );
};

const TowerClimbingView = ({ classes }: { classes: Class[] }) => {
  return (
    <div className="relative w-full aspect-[9/16] md:aspect-[3/4] max-w-2xl mx-auto bg-slate-950 rounded-[48px] overflow-hidden border border-white/10 shadow-3xl">
      {/* Base Background Layer - Dimmed to prevent light leakage at edges */}
      <div className="absolute inset-0 bg-slate-900" />
      
      {/* Main Unified Tower Container */}
      {/* This is the master coordinate system for everything between 0% and 100% */}
      <div className="absolute inset-x-4 top-20 bottom-24 z-10 selection:bg-transparent">
        
        {/* 101 Background Image - Forced height alignment with scale */}
        <div 
          className="absolute inset-0 bg-[url('https://i.meee.com.tw/wqKw2XB.png')] bg-contain bg-bottom bg-no-repeat brightness-[1.2] contrast-[1.15] saturate-[1.1] pointer-events-none mx-auto max-w-xl"
        />
        
        {/* Subtle Inner Glow/Vignette to make the tower pop */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/40 via-transparent to-slate-950/20 pointer-events-none rounded-2xl" />

        {/* Precision Scale & Percentages */}
        <div className="absolute inset-y-0 -left-1 right-0 flex flex-col-reverse justify-between pointer-events-none">
          {Array.from({ length: 11 }).map((_, i) => {
            const percent = i * 10;
            return (
              <div 
                key={percent} 
                className="w-full flex items-center group/scale"
              >
                {/* Horizontal Tick Line */}
                <div className="flex-1 h-px bg-white/15" />
                {/* Absolute Percent Label - perfectly aligned to tick */}
                <div className="absolute left-1 flex items-center">
                  <span className="text-[9px] font-black text-white/80 drop-shadow-[0_1px_4px_rgba(0,0,0,1)] uppercase tracking-tighter">
                    {percent}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Dynamic Interactive Layer (Class Icons) */}
        <div className="absolute left-12 right-4 top-0 bottom-0 overflow-visible">
          {classes.map((c, idx) => {
            const { towerCount, currentFloor, floorProgress } = getTowerStats(c.totalCount);
            // Calculate absolute bottom percentage
            const totalPercent = ((currentFloor - 1) / 20 * 100) + (floorProgress / 20);
            
            // Horizontal spreading - adjusted for left offset
            const horizontalPosition = (idx / (classes.length - 1 || 1)) * 100;
            
            // Name simplification
            const shortName = c.name.replace('年', '').replace('班', '');
            const isTopped = totalPercent > 98;

            return (
              <motion.div
                key={c.id}
                initial={{ bottom: 0 }}
                animate={{ bottom: `${totalPercent}%` }}
                transition={{ duration: 2, ease: "circOut" }}
                className="absolute -translate-x-1/2 flex items-center justify-center z-20"
                style={{ left: `${horizontalPosition}%` }}
              >
                <div className="relative flex flex-col items-center">
                  {/* Glassmorphic Badge - Staggered Height */}
                  <div className="absolute flex flex-col items-center" style={{ bottom: idx % 2 === 0 ? '110%' : '150%' }}>
                     {towerCount > 0 && (
                        <motion.div 
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="bg-rose-500 text-white text-[6px] px-1 rounded-full font-black mb-0.5 shadow-lg border border-white/20 whitespace-nowrap"
                        >
                          ★ x{towerCount}
                        </motion.div>
                     )}
                    <motion.div 
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "px-1.5 py-0.5 rounded-full border text-[5px] font-black shadow-2xl backdrop-blur-xl transition-all whitespace-nowrap",
                        towerCount > 0 
                          ? "bg-yellow-400 text-yellow-950 border-white/50" 
                          : "bg-black/60 text-white border-white/20"
                      )}
                    >
                      {shortName}
                    </motion.div>
                  </div>

                  {/* Icon Marker */}
                  <div className={cn(
                    "w-3.5 h-3.5 rounded-full border flex items-center justify-center ring-2 ring-black/40 transition-all",
                    (towerCount > 0 || isTopped) && "drop-shadow-[0_0_8px_rgba(255,255,255,0.8)] animate-pulse shadow-white/50",
                    idx % 3 === 0 ? "bg-indigo-500 border-indigo-300" : 
                    idx % 3 === 1 ? "bg-teal-500 border-teal-300" : "bg-rose-500 border-rose-300"
                  )}>
                    <UserIcon size={7} className="text-white" fill="white" />
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Persistent UI Overlays (Glassmorphic) */}
      {/* Header - Moved up to top-2 to avoid blocking the 100% mark at top-20 */}
      <div className="absolute top-2 left-6 z-30 pointer-events-none">
        <div className="bg-black/80 backdrop-blur-2xl px-4 py-2.5 rounded-2xl border border-white/20 shadow-[0_15px_40px_rgba(0,0,0,0.6)]">
          <div className="text-[8px] font-black text-rose-500 tracking-[0.2em] mb-0.5 uppercase">Performance Tracker</div>
          <div className="text-base font-black text-white italic tracking-tight drop-shadow-sm font-sans underline decoration-rose-500/30 decoration-2 underline-offset-4">
            TAIPEI 101 CHALLENGE
          </div>
        </div>
      </div>

      {/* Version & Environment - Moved up to top-4 */}
      <div className="absolute top-4 right-6 z-30 pointer-events-none flex flex-col items-end gap-2">
        <div className="px-3 py-1 bg-black/80 backdrop-blur-2xl rounded-full border border-white/20 text-white font-black text-[8px] italic shadow-xl">
          V1.0.RC
        </div>
      </div>
    </div>
  );
};


// --- Components ---

const Button = ({ 
  children, 
  className, 
  variant = 'primary', 
  size = 'md', 
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { 
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
}) => {
  const variants = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20 active:scale-95 border border-indigo-400/20',
    secondary: 'bg-white/10 text-white hover:bg-white/20 backdrop-blur-md active:scale-95 border border-white/10',
    ghost: 'bg-transparent text-slate-400 hover:text-white hover:bg-white/5 active:scale-95 transition-all',
    danger: 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 active:scale-95 border border-rose-500/20',
    success: 'bg-teal-600 text-white hover:bg-teal-500 shadow-lg shadow-teal-500/20 border border-teal-400/20'
  };
  const sizes = {
    sm: 'px-3 py-1.5 text-xs rounded-xl font-bold tracking-wide uppercase',
    md: 'px-4 py-2.5 text-sm rounded-xl font-bold tracking-tight',
    lg: 'px-6 py-3.5 text-base rounded-2xl font-black tracking-tight'
  };
  
  return (
    <button 
      className={cn(
        'transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed', 
        variants[variant], 
        sizes[size], 
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};

const Card = ({ children, className, id, ...props }: { children: React.ReactNode, className?: string, id?: string } & React.HTMLAttributes<HTMLDivElement>) => (
  <div id={id} className={cn('bg-white/5 backdrop-blur-xl rounded-[32px] p-6 shadow-2xl border border-white/10 overflow-hidden relative group', className)} {...props}>
    {children}
  </div>
);

const Badge = ({ children, color = 'blue' }: { children: React.ReactNode, color?: 'blue' | 'yellow' | 'green' | 'red' | 'purple' }) => {
  const colors = {
    blue: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    yellow: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    green: 'bg-teal-500/20 text-teal-300 border-teal-500/30',
    red: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
    purple: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  };
  return (
    <span className={cn('px-2.5 py-1 rounded-lg text-[10px] font-black border uppercase tracking-wider', colors[color])}>
      {children}
    </span>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'records' | 'ranking' | 'total' | 'admin'>('records');
  
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [adminUnlocked, setAdminUnlocked] = useState(false);

  // Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      // Hardcoded admin for demo: blueymch@gmail.com
      setIsAdmin(u?.email === 'blueymch@gmail.com');
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Fetch Classes
  useEffect(() => {
    const fetchClasses = async () => {
      try {
        const q = query(collection(db, 'classes'));
        const snap = await getDocs(q);
        const fetched = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Class));
        fetched.sort((a, b) => getClassSortValue(a.name) - getClassSortValue(b.name));
        setClasses(fetched);
        if (fetched.length > 0 && !selectedClassId) {
          setSelectedClassId(fetched[0].id);
        }
      } catch (err) {
        console.error('Fetch classes error:', err);
      }
    };
    fetchClasses();
  }, [selectedClassId]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Login failed', err);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0f172a]">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/40 via-purple-900/20 to-teal-900/40 pointer-events-none"></div>
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full shadow-lg shadow-indigo-500/20"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] pb-28 font-sans text-slate-200 relative overflow-hidden">
      {/* Background blobs */}
      <div className="fixed inset-0 bg-gradient-to-br from-indigo-900/30 via-slate-900/50 to-teal-900/30 pointer-events-none"></div>
      <div className="fixed top-0 left-0 w-1/2 h-1/2 bg-indigo-500/5 blur-[160px] pointer-events-none"></div>
      <div className="fixed bottom-0 right-0 w-1/2 h-1/2 bg-teal-500/5 blur-[160px] pointer-events-none"></div>

      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900/40 backdrop-blur-3xl border-b border-white/5 px-6 py-5 flex flex-col gap-6 shadow-2xl">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-tr from-indigo-600 to-indigo-400 text-white rounded-2xl flex items-center justify-center shadow-xl shadow-indigo-500/20 ring-1 ring-white/20">
                <Trophy size={24} />
              </div>
              <div>
                <h1 className="font-black text-2xl tracking-tighter leading-none text-white">繩彩飛揚 <span className="text-indigo-400">v2.0</span></h1>
                <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] mt-1.5 flex items-center gap-1.5">
                  <span className="w-1 h-1 bg-indigo-500 rounded-full animate-pulse"></span>
                  Jump Rope Tracking
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
                {adminUnlocked && <Badge color="purple">管理者</Badge>}
                {user ? (
                   <button onClick={handleLogout} className="w-11 h-11 rounded-2xl overflow-hidden ring-2 ring-white/10 hover:ring-indigo-500/50 transition-all shadow-xl group relative">
                       <img src={user.photoURL || ''} alt="profile" referrerPolicy="no-referrer" className="w-full h-full object-cover group-hover:scale-110 transition-transform active:scale-95" />
                       <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors"></div>
                   </button>
                ) : (
                   <button onClick={handleLogin} className="w-11 h-11 rounded-2xl flex items-center justify-center bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10 transition-all shadow-xl">
                       <LogIn size={20} />
                   </button>
                )}
            </div>
        </div>

        {/* Top Navigation */}
        <nav className="flex justify-center">
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 shadow-xl rounded-2xl p-1.5 flex gap-1 items-center ring-1 ring-white/5">
            {[
                { id: 'records', icon: Calendar, label: '紀錄' },
                { id: 'ranking', icon: Trophy, label: '排行' },
                { id: 'total', icon: BarChart3, label: '總榜' },
                { id: 'admin', icon: Settings, label: '管理' },
            ].map((tab) => (
                <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                    'flex items-center justify-center py-2.5 px-5 rounded-[14px] transition-all duration-500 gap-2 relative overflow-hidden group',
                    activeTab === tab.id 
                    ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/20' 
                    : 'text-slate-500 hover:text-slate-300'
                )}
                >
                <tab.icon size={18} strokeWidth={activeTab === tab.id ? 3 : 2} />
                <span className="text-xs font-black tracking-widest uppercase">{tab.label}</span>
                {activeTab === tab.id && (
                    <motion.div 
                    layoutId="activeTabGlow"
                    className="absolute inset-0 bg-white/20 blur-xl opacity-50"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                    />
                )}
                </button>
            ))}
            </div>
        </nav>
      </header>

      <main className="max-w-2xl mx-auto px-6 pt-10 pb-20 relative z-10">
        <AnimatePresence mode="wait">
          {activeTab === 'records' && (
            <RecordsView 
              classes={classes} 
              selectedClassId={selectedClassId} 
              setSelectedClassId={setSelectedClassId}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
            />
          )}
          {activeTab === 'ranking' && (
            <RankingView 
              classes={classes}
              selectedClassId={selectedClassId}
              setSelectedClassId={setSelectedClassId}
            />
          )}
          {activeTab === 'total' && <TotalView />}
          {activeTab === 'admin' && (
            <AdminView 
                isAdmin={adminUnlocked}
                classes={classes}
                user={user}
                handleLogout={handleLogout}
                handleLogin={handleLogin}
                setAdminUnlocked={setAdminUnlocked}
                onClassUpdate={() => {
                    const fetchClasses = async () => {
                        const q = query(collection(db, 'classes'));
                        const snap = await getDocs(q);
                        const fetched = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Class));
                        fetched.sort((a, b) => getClassSortValue(a.name) - getClassSortValue(b.name));
                        setClasses(fetched);
                    };
                    fetchClasses();
                }}
            />
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// --- Views ---

function RecordsView({ 
    classes, 
    selectedClassId, 
    setSelectedClassId, 
    selectedDate, 
    setSelectedDate 
}: { 
    classes: Class[], 
    selectedClassId: string, 
    setSelectedClassId: (id: string) => void,
    selectedDate: string,
    setSelectedDate: (d: string) => void
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<JumpRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedClassId) return;
    const fetchData = async () => {
      setLoading(true);
      try {
        const sq = query(collection(db, 'students'), where('classId', '==', selectedClassId));
        const sSnap = await getDocs(sq);
        const sList = sSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));
        
        // Numeric sort by seat number as requested by user
        sList.sort((a, b) => {
            const numA = parseInt(a.seatNumber || '0', 10);
            const numB = parseInt(b.seatNumber || '0', 10);
            if (numA !== numB) return numA - numB;
            return a.name.localeCompare(b.name, 'zh-Hant-TW');
        });
        
        setStudents(sList);

        const rq = query(
            collection(db, 'records'), 
            where('classId', '==', selectedClassId),
            where('date', '==', selectedDate)
        );
        const rSnap = await getDocs(rq);
        setRecords(rSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as JumpRecord)));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [selectedClassId, selectedDate]);

  const studentCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    records.forEach(r => {
      map[r.studentId] = r.count;
    });
    return map;
  }, [records]);

  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} key="records-view">
      <header className="flex flex-col gap-5 mb-10">
        <div className="flex items-center gap-3">
            <Calendar className="text-indigo-400" size={24} />
            <h2 className="text-3xl font-black tracking-tighter text-white">每日紀錄 <span className="text-indigo-400">Records</span></h2>
        </div>
        <div className="flex gap-3">
            <select 
                value={selectedClassId} 
                onChange={(e) => setSelectedClassId(e.target.value)}
                className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-4 font-bold text-white focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all appearance-none backdrop-blur-xl"
            >
                <option value="" className="bg-slate-900">選擇班級</option>
                {classes.map(c => <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>)}
            </select>
            <input 
                type="date" 
                value={selectedDate} 
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-2xl px-5 py-4 font-bold text-white focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all backdrop-blur-xl"
            />
        </div>
      </header>

      {loading ? (
        <div className="py-20 flex justify-center"><div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin shadow-lg shadow-indigo-500/20" /></div>
      ) : (
        <div className="grid gap-4">
          {students.length === 0 ? (
            <Card className="flex flex-col items-center justify-center py-24 bg-white/2 border-dashed">
               <Users className="text-slate-700 mb-6" size={64} strokeWidth={1} />
               <p className="text-slate-500 font-bold tracking-wide">此班級尚無學生名單</p>
            </Card>
          ) : (
            students.map((student, idx) => (
              <Card key={student.id} className="p-5 flex items-center justify-between hover:bg-white/10 transition-all cursor-default border-white/5">
                <div className="flex items-center gap-5">
                  <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-sm font-black text-slate-500 ring-1 ring-white/10 group-hover:bg-indigo-500 group-hover:text-white transition-all">
                    {student.seatNumber || (idx + 1)}
                  </div>
                  <span className="font-black text-xl text-white tracking-tight">{student.name}</span>
                </div>
                <div className="flex items-end gap-2 pr-2">
                    <span className="text-3xl font-black text-indigo-400 tabular-nums">{studentCountMap[student.id] || 0}</span>
                    <span className="text-[10px] font-black text-slate-500 uppercase pb-1.5 tracking-widest">下</span>
                </div>
              </Card>
            ))
          )}
        </div>
      )}
    </motion.div>
  );
}

function RankingView({ 
    classes, 
    selectedClassId, 
    setSelectedClassId 
}: { 
    classes: Class[], 
    selectedClassId: string, 
    setSelectedClassId: (id: string) => void 
}) {
  const [rankings, setRankings] = useState<Student[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selectedClassId) return;
    const fetchRanking = async () => {
      setLoading(true);
      try {
        const q = query(
            collection(db, 'students'), 
            where('classId', '==', selectedClassId),
            orderBy('totalCount', 'desc')
        );
        const snap = await getDocs(q);
        const sList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));
        
        // Secondary sort by seat number if counts are equal (consistent with other views)
        sList.sort((a, b) => {
            if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
            const numA = parseInt(a.seatNumber || '0', 10);
            const numB = parseInt(b.seatNumber || '0', 10);
            if (numA !== numB) return numA - numB;
            return a.name.localeCompare(b.name, 'zh-Hant-TW');
        });
        
        setRankings(sList.slice(0, 50));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchRanking();
  }, [selectedClassId]);

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }} key="ranking-view">
      <header className="flex flex-col gap-5 mb-10">
        <div className="flex items-center gap-3">
            <Trophy className="text-yellow-400" size={24} />
            <h2 className="text-3xl font-black tracking-tighter text-white">班級英雄榜 <span className="text-yellow-400">Rank</span></h2>
        </div>
        <select 
            value={selectedClassId} 
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 font-bold text-white focus:ring-2 focus:ring-yellow-500/50 outline-none appearance-none backdrop-blur-xl"
        >
            <option value="" className="bg-slate-900">選擇班級</option>
            {classes.map(c => <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>)}
        </select>
      </header>

      {loading ? (
        <div className="py-20 flex justify-center"><div className="w-10 h-10 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin shadow-lg shadow-yellow-500/20" /></div>
      ) : (
        <div className="grid gap-4">
          {rankings.map((student, idx) => {
            const displayRank = rankings.filter(s => s.totalCount > student.totalCount).length + 1;
            return (
            <Card key={student.id} className={cn("p-5 flex items-center justify-between border-l-4", 
                displayRank === 1 ? "border-l-yellow-400 bg-yellow-400/10" : 
                displayRank === 2 ? "border-l-indigo-300 bg-indigo-300/10" : 
                displayRank === 3 ? "border-l-orange-500 bg-orange-500/10" : "border-l-white/10"
            )}>
              <div className="flex items-center gap-5">
                <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shadow-xl ring-1 ring-white/10", 
                    displayRank === 1 ? "bg-gradient-to-tr from-yellow-600 to-yellow-400 text-white shadow-yellow-500/20" : 
                    displayRank === 2 ? "bg-gradient-to-tr from-indigo-500 to-indigo-300 text-white shadow-indigo-500/20" : 
                    displayRank === 3 ? "bg-gradient-to-tr from-orange-600 to-orange-400 text-white shadow-orange-500/20" : "bg-white/5 text-slate-400"
                )}>
                  {displayRank}
                </div>
                <div className="flex flex-col">
                    <span className="font-black text-xl text-white tracking-tight">{student.name}</span>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-0.5">Class Student</span>
                </div>
              </div>
              <div className="text-right pr-2">
                  <div className="text-3xl font-black text-white leading-tight tabular-nums">{student.totalCount.toLocaleString()}</div>
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mt-0.5">Total Jumps</div>
              </div>
            </Card>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

function TotalView() {
  const [activeGrade, setActiveGrade] = useState<GradeLevel>('Low');
  const [classRankings, setClassRankings] = useState<Class[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'climb'>('climb');

  useEffect(() => {
    const fetchTotalRanking = async () => {
      setLoading(true);
      try {
        const q = query(
            collection(db, 'classes')
        );
        const snap = await getDocs(q);
        const allFetched = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Class));
        
        // Sort by totalCount desc, then by class order
        allFetched.sort((a, b) => {
            if (b.totalCount !== a.totalCount) return b.totalCount - a.totalCount;
            return getClassSortValue(a.name) - getClassSortValue(b.name);
        });

        // Filter by inferred grade level to ensure "automatic classification"
        const filtered = allFetched.filter(c => getGradeLevelFromName(c.name) === activeGrade);
        setClassRankings(filtered);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchTotalRanking();
  }, [activeGrade]);

  const gradeLabels = { Low: '低年級組', Middle: '中年級組', High: '高年級組' };
  const gradeThresholds = {
    Low: '每日 300 下 • 每週 4 天',
    Middle: '每日 500 下 • 每週 1 天',
    High: '每日 800 下 • 每週 1 天'
  };

  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -30 }} key="total-ranking-view">
      <header className="flex flex-col gap-6 mb-12">
        <div className="space-y-1">
            <div className="flex items-center gap-3">
                <div className="p-2 bg-teal-500/20 rounded-lg">
                    <Globe className="text-teal-400" size={20} />
                </div>
                <h2 className="text-3xl font-black tracking-tighter text-white italic uppercase italic">快活跳繩大挑戰</h2>
            </div>
            <div className="flex items-center gap-2 pl-1">
                <span className="text-4xl font-black text-indigo-400 tracking-tighter uppercase italic">挑戰台北 101</span>
                <span className="px-2 py-0.5 bg-rose-500 text-white text-[10px] font-black rounded italic animate-bounce">NEW MODE</span>
            </div>
        </div>
        
        <div className="space-y-6">
            <div className="flex bg-slate-800/80 backdrop-blur-3xl rounded-[24px] p-1.5 border border-white/10 shadow-2xl ring-1 ring-white/5">
                {(['Low', 'Middle', 'High'] as GradeLevel[]).map(g => (
                <button
                    key={g}
                    onClick={() => setActiveGrade(g)}
                    className={cn(
                    'flex-1 py-3.5 px-4 rounded-[20px] text-xs font-black tracking-widest transition-all cursor-pointer uppercase relative overflow-hidden group',
                    activeGrade === g 
                        ? 'bg-gradient-to-br from-indigo-600 to-indigo-500 text-white shadow-xl shadow-indigo-500/20' 
                        : 'text-slate-500 hover:text-slate-300'
                    )}
                >
                    <span className="relative z-10">{gradeLabels[g]}</span>
                    {activeGrade === g && (
                        <motion.div layoutId="gradeGlow" className="absolute inset-0 bg-white/20 blur-xl" />
                    )}
                </button>
                ))}
            </div>

            <div className="flex justify-center">
              <button 
                onClick={() => setViewMode(v => v === 'list' ? 'climb' : 'list')}
                className="flex items-center gap-3 px-8 py-3 bg-white/5 hover:bg-white/10 rounded-full border border-white/10 transition-all group active:scale-95"
              >
                {viewMode === 'list' ? (
                  <>
                    <Layout size={18} className="text-teal-400 group-hover:rotate-12 transition-transform" />
                    <span className="text-xs font-black text-white uppercase tracking-widest">切換至登高地圖 Climb Mode</span>
                  </>
                ) : (
                  <>
                    <List size={18} className="text-indigo-400 group-hover:-rotate-12 transition-transform" />
                    <span className="text-xs font-black text-white uppercase tracking-widest">切換至名次清單 List Mode</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center justify-between px-3">
                <div className="flex items-center gap-2 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                    <Clock size={12} className="text-indigo-400" />
                    門檻: {gradeThresholds[activeGrade]}
                </div>
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">
                    1 下 = 1 CM
                </div>
            </div>
        </div>
      </header>

      {loading ? (
         <div className="py-20 flex justify-center"><div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin shadow-lg shadow-teal-500/20" /></div>
      ) : (
        <div className="space-y-12">
          {classRankings.length === 0 ? (
             <Card className="flex flex-col items-center justify-center py-24 bg-white/2 border-dashed">
                <Users className="text-slate-700 mb-6" size={64} strokeWidth={1} />
                <p className="text-slate-500 font-bold tracking-wide">暫無排行榜數據</p>
             </Card>
          ) : viewMode === 'climb' ? (
            <TowerClimbingView classes={classRankings} />
          ) : (
            <div className="grid gap-12">
              {classRankings.map((c, idx) => {
                const { towerCount, currentFloor, floorProgress, remainingJumps } = getTowerStats(c.totalCount);
                const displayRank = classRankings.filter(cl => cl.totalCount > c.totalCount).length + 1;
                
                return (
                  <div key={c.id} className="relative">
                    {/* Rank Badge */}
                    {displayRank <= 3 && (
                        <div className={cn(
                            "absolute -top-6 -left-2 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-[2px] z-20 shadow-xl border italic",
                            displayRank === 1 ? "bg-yellow-400 text-yellow-950 border-yellow-300" :
                            displayRank === 2 ? "bg-slate-300 text-slate-900 border-slate-200" :
                            "bg-orange-500 text-white border-orange-400"
                        )}>
                            {displayRank === 1 ? 'Challenger No.1' : `Rank ${displayRank}`}
                        </div>
                    )}
    
                    {/* Unified Card Structure */}
                    <div className="relative w-full bg-[#1e2336] rounded-[2.5rem] p-6 sm:p-8 flex gap-4 sm:gap-6 overflow-hidden border border-white/5 shadow-2xl ring-1 ring-white/5">
                        
                        {/* Left Column: 101 Visual */}
                        <div className="w-20 sm:w-24 shrink-0 flex flex-col items-center gap-4">
                            <Taipei101Visual jumps={remainingJumps} towerCount={towerCount} />
                            <div className="flex flex-col items-center text-center">
                                <span className={cn(
                                    "text-[9px] font-black uppercase tracking-widest italic",
                                    towerCount > 0 ? "text-rose-500 animate-pulse" : "text-slate-600"
                                )}>
                                    {towerCount > 0 ? "Ascended" : "Climbing"}
                                </span>
                                {towerCount > 0 && (
                                    <span className="text-xl font-black text-white italic tracking-tighter">x{towerCount}</span>
                                )}
                            </div>
                        </div>

                        {/* Right Column: Information */}
                        <div className="flex-1 min-w-0 flex flex-col">
                            {/* Header Row: Class, Tier, Score */}
                            <div className="flex justify-between items-start gap-4">
                                <div className="flex gap-4 shrink-0">
                                    {/* Class Name (Vertical) */}
                                    <h2 className="text-3xl sm:text-4xl font-bold tracking-widest text-white w-10 text-center leading-none break-all py-1">
                                        {c.name}
                                    </h2>
                                    {/* Tier Badge (Vertical) */}
                                    <div className={cn(
                                        "flex items-center justify-center border rounded-xl px-2 py-4 text-[10px] sm:text-xs font-black uppercase [writing-mode:vertical-rl] leading-none transition-all",
                                        getTierColorClass(towerCount),
                                        "border-current/30 bg-current/5 shadow-lg"
                                    )}>
                                        {getTierName(towerCount)}
                                    </div>
                                </div>

                                {/* Score Section */}
                                <div className="flex-1 min-w-0 text-right flex flex-col items-end">
                                    <div className="text-2xl sm:text-4xl md:text-5xl font-black text-white truncate w-full tracking-tighter leading-none" title={c.totalCount.toLocaleString()}>
                                        {c.totalCount.toLocaleString()}
                                    </div>
                                    <div className="text-[8px] font-black text-slate-500 tracking-[0.2em] mt-2 uppercase italic">
                                        Total CM / Jumps
                                    </div>
                                </div>
                            </div>

                            {/* Current Progress Badge */}
                            <div className="mt-6 flex">
                                <div className={cn(
                                    "inline-block px-4 py-2 rounded-xl text-xs sm:text-sm font-black tracking-widest border shadow-lg transition-all",
                                    towerCount >= 3 ? "bg-rose-900/30 border-rose-500/30 text-rose-200" :
                                    towerCount >= 1 ? "bg-amber-900/30 border-amber-500/30 text-amber-200" :
                                    "bg-indigo-900/30 border-indigo-500/30 text-indigo-200"
                                )}>
                                    目前在第 {towerCount + 1} 棟 第 {currentFloor} 層
                                </div>
                            </div>

                            {/* Progress Bars */}
                            <div className="mt-auto pt-8">
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center px-1">
                                        <div className="flex items-center gap-2">
                                            <div className={cn("w-1.5 h-1.5 rounded-full", towerCount > 0 ? "animate-pulse bg-rose-500" : "bg-teal-500")} />
                                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Stage Progress</span>
                                        </div>
                                        <span className="text-xs font-black text-white italic">
                                            {Math.round(floorProgress)}%
                                        </span>
                                    </div>
                                    <div className="h-4 bg-black/40 rounded-full overflow-hidden p-1 border border-white/10 shadow-inner">
                                        <motion.div 
                                            initial={{ width: 0 }}
                                            animate={{ width: `${floorProgress}%` }}
                                            className={cn(
                                                "h-full rounded-full bg-gradient-to-r shadow-[0_0_10px_rgba(255,255,255,0.1)]",
                                                getTowerStyles(towerCount)
                                            )}
                                        />
                                    </div>
                                    <div className="flex justify-between items-center text-[8px] font-bold text-slate-500 uppercase tracking-[0.15em] pt-1 px-1">
                                        <span>Floor Step {currentFloor}</span>
                                        <span>Next Level: {Math.max(0, FLOOR_SIZE - (remainingJumps % FLOOR_SIZE)).toLocaleString()} CM</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

function AdminView({ 
    isAdmin, 
    classes, 
    onClassUpdate,
    user,
    handleLogout,
    handleLogin,
    setAdminUnlocked
}: { 
    isAdmin: boolean, 
    classes: Class[], 
    onClassUpdate: () => void,
    user: User | null,
    handleLogout: () => void,
    handleLogin: () => void,
    setAdminUnlocked: (v: boolean) => void
}) {
  const [adminTab, setAdminTab] = useState<'menu' | 'input' | 'classes' | 'export' | 'records' | 'ai'>('menu');
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  
  if (!isAdmin) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md mx-auto">
        <Card className="p-8 text-center flex flex-col gap-6">
          <div className="w-16 h-16 bg-white/5 text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-2">
            <Settings size={32} />
          </div>
          <h3 className="text-3xl font-black text-white tracking-tighter italic uppercase">Admin Access</h3>
          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">請輸入管理員密碼</p>
          
          <div className="space-y-4">
            <input 
              type="password" 
              placeholder="· · · · · ·" 
              className={cn(
                "w-full bg-indigo-50/5 border rounded-[32px] px-8 py-6 text-center font-bold text-3xl text-white outline-none transition-all tracking-[0.5em]",
                passwordError ? "border-rose-500 ring-4 ring-rose-500/10" : "border-indigo-500/20 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10"
              )}
              value={passwordInput}
              onChange={(e) => {
                setPasswordInput(e.target.value);
                setPasswordError(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (passwordInput === '183618') setAdminUnlocked(true);
                  else setPasswordError(true);
                }
              }}
            />
            {passwordError && <p className="text-rose-400 text-xs font-bold animate-shake">密碼錯誤，請再試一次</p>}
          </div>

          <Button 
            onClick={() => {
              if (passwordInput === '183618') setAdminUnlocked(true);
              else setPasswordError(true);
            }}
            className="w-full h-16 rounded-[24px] bg-[#0f172a] hover:bg-slate-800 text-white border-none shadow-none text-xl font-black"
          >
            確認進入
          </Button>
        </Card>
      </motion.div>
    );
  }

  if (adminTab === 'menu') {
    return (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <header className="flex items-center justify-between px-2">
            <h2 className="text-2xl font-bold text-slate-400 italic">管理員功能</h2>
            <div className="flex items-center gap-4">
                <button 
                  onClick={() => setAdminUnlocked(false)}
                  className="text-slate-500 text-sm font-bold flex items-center gap-1.5 hover:text-slate-300 transition-colors"
                >
                  切換使用者
                </button>
                {user && (
                  <button onClick={handleLogout} className="text-rose-400 text-sm font-bold flex items-center gap-1.5 hover:text-rose-300 transition-colors">
                      <LogOut size={16} /> 登出
                  </button>
                )}
            </div>
        </header>

        {/* Sync Info Card */}
        {user ? (
          <div className="bg-teal-500/5 border border-teal-500/20 rounded-[32px] p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-teal-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-teal-500/20">
                      <Globe size={24} />
                  </div>
                  <div>
                      <div className="text-[10px] font-black text-teal-400 uppercase tracking-widest mb-0.5">Firebase Cloud Sync</div>
                      <div className="text-slate-200 font-bold">已連線: <span className="italic">{user.email}</span></div>
                  </div>
              </div>
              <button onClick={handleLogout} className="bg-white px-4 py-2 rounded-xl text-[10px] font-black text-rose-500 shadow-sm border border-rose-100 uppercase tracking-widest hover:bg-rose-50 transition-colors">
                  登出雲端
              </button>
          </div>
        ) : (
          <div className="bg-white/5 border border-white/10 rounded-[32px] p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center text-slate-400">
                      <Globe size={24} />
                  </div>
                  <div>
                      <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Firebase Cloud Sync</div>
                      <div className="text-slate-400 font-bold">未登入雲端同步</div>
                  </div>
              </div>
              <button onClick={handleLogin} className="bg-indigo-600 px-4 py-2 rounded-xl text-[10px] font-black text-white hover:bg-indigo-500 transition-colors">
                  登入同步
              </button>
          </div>
        )}

        {/* Cloud Sync All Data Button */}
        <motion.button 
          whileTap={{ scale: 0.98 }}
          disabled={syncing}
          onClick={async () => {
            console.log('Syncing button clicked');
            try {
                if (!confirm('將會同步並校準所有班級與學生的雲端總次數數據。這可能需要一點時間，確定嗎？')) return;
                setSyncing(true);
                
                // 1. Fetch all records
                const rSnap = await getDocs(collection(db, 'records')).catch(err => {
                    handleFSLocalError(err, 'get', 'records_sync');
                    throw err;
                });
                
                if (rSnap.empty) {
                    alert('目前雲端沒有任何練習紀錄，無法進行同步校準。');
                    setSyncing(false);
                    return;
                }

                console.log(`Found ${rSnap.docs.length} records. Calculating totals...`);
                const sTotals: Record<string, number> = {};
                const cTotals: Record<string, number> = {};
                
                rSnap.docs.forEach(d => {
                    const data = d.data();
                    const sid = data.studentId;
                    const cid = data.classId;
                    const count = data.count || 0;
                    if (sid) sTotals[sid] = (sTotals[sid] || 0) + count;
                    if (cid) cTotals[cid] = (cTotals[cid] || 0) + count;
                });
                
                // 2. Fetch all students and classes to update
                const [sSnap, cSnap] = await Promise.all([
                    getDocs(collection(db, 'students')),
                    getDocs(collection(db, 'classes'))
                ]);
                
                // 3. Perform batch updates (Firestore batch limit is 500)
                const studentsDocs = sSnap.docs;
                const classesDocs = cSnap.docs;
                
                const allEntities = [
                    ...studentsDocs.map(d => ({ ref: doc(db, 'students', d.id), totalCount: sTotals[d.id] || 0 })),
                    ...classesDocs.map(d => ({ ref: doc(db, 'classes', d.id), totalCount: cTotals[d.id] || 0 }))
                ];
                
                if (allEntities.length === 0) {
                    alert('沒有找到任何班級或學生資料。');
                    setSyncing(false);
                    return;
                }
                
                const chunkSize = 450;
                for (let i = 0; i < allEntities.length; i += chunkSize) {
                    const chunk = allEntities.slice(i, i + chunkSize);
                    const batch = writeBatch(db);
                    chunk.forEach(item => {
                        batch.update(item.ref, { totalCount: item.totalCount });
                    });
                    await batch.commit().catch(err => {
                        handleFSLocalError(err, 'write', 'batch_full_sync');
                        throw err;
                    });
                }
                
                onClassUpdate();
                alert('所有資料已成功同步至雲端並校準總計數據！');
            } catch (err) {
                console.error('Full Sync Error:', err);
                alert('同步失敗：' + (err instanceof Error ? err.message : '發生未知錯誤'));
            } finally {
                setSyncing(false);
            }
          }}
          className="w-full bg-indigo-500/5 border border-indigo-500/10 rounded-2xl py-4 flex items-center justify-center gap-2 text-indigo-400 font-bold hover:bg-indigo-500/10 transition-all group disabled:opacity-50 mb-6"
        >
            <motion.div 
                animate={syncing ? { rotate: 360 } : {}}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
            >
                {syncing ? <RotateCcw size={18} className="text-indigo-400" /> : <Globe size={18} className="text-indigo-400" />}
            </motion.div>
            {syncing ? '全面數據同步中...' : '同步所有資料至雲端'}
        </motion.button>

        {/* Main Actions Grid */}
        <div className="grid grid-cols-2 gap-4">
            <button 
                onClick={() => setAdminTab('input')}
                className="bg-indigo-600 rounded-[32px] p-8 flex flex-col items-center justify-center gap-4 shadow-xl shadow-indigo-600/20 hover:scale-[1.02] active:scale-95 transition-all text-white group"
            >
                <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    <ClipboardList size={32} />
                </div>
                <span className="text-xl font-bold">登記次數</span>
            </button>
            <button 
                onClick={() => setAdminTab('ai')}
                className="bg-indigo-500 rounded-[32px] p-8 flex flex-col items-center justify-center gap-4 shadow-xl shadow-indigo-500/20 hover:scale-[1.02] active:scale-95 transition-all text-white group"
            >
                <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Camera size={32} />
                </div>
                <span className="text-xl font-bold">AI 掃描</span>
            </button>
        </div>

        {/* List Actions */}
        <div className="space-y-4">
            <button 
                onClick={() => setAdminTab('records')}
                className="w-full bg-slate-900 border border-white/10 rounded-full py-6 flex items-center justify-center gap-4 text-white hover:bg-slate-800 transition-all shadow-xl group"
            >
                <RotateCcw size={28} className="text-slate-400 group-hover:text-white transition-colors" />
                <span className="text-xl font-bold tracking-tight">查看跳繩紀錄</span>
            </button>
            <button 
                onClick={() => setAdminTab('export')}
                className="w-full bg-white border border-slate-100 rounded-full py-6 flex items-center justify-center gap-4 text-slate-800 hover:bg-slate-50 transition-all shadow-md group"
            >
                <BarChart3 size={28} className="text-slate-400 group-hover:text-indigo-500 transition-colors" />
                <span className="text-xl font-bold tracking-tight">統計數據分析</span>
            </button>
            <button 
                onClick={() => setAdminTab('classes')}
                className="w-full bg-white border border-slate-100 rounded-full py-6 flex items-center justify-center gap-4 text-slate-800 hover:bg-slate-50 transition-all shadow-md group"
            >
                <Users size={28} className="text-slate-400 group-hover:text-indigo-500 transition-colors" />
                <span className="text-xl font-bold tracking-tight">班級資料管理</span>
            </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} key="admin-view" className="space-y-6">
      <header className="flex items-center gap-4 mb-8">
        <button 
            onClick={() => setAdminTab('menu')}
            className="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-all shadow-sm"
        >
            <ArrowLeft size={24} />
        </button>
        <h2 className="text-3xl font-bold text-slate-800 italic tracking-tight">
            {adminTab === 'input' && '登記次數'}
            {adminTab === 'classes' && '班級資料管理'}
            {adminTab === 'export' && '數據統計分析'}
            {adminTab === 'records' && '跳繩紀錄瀏覽'}
            {adminTab === 'ai' && 'AI 智慧掃描'}
        </h2>
      </header>

      {adminTab === 'input' && <AdminInputView classes={classes} user={user} handleLogin={handleLogin} onBack={() => setAdminTab('menu')} />}
      {adminTab === 'classes' && <AdminClassesView classes={classes} user={user} handleLogin={handleLogin} onUpdate={onClassUpdate} />}
      {adminTab === 'export' && <AdminExportView user={user} handleLogin={handleLogin} />}
      {adminTab === 'records' && <AdminRecordsListView classes={classes} user={user} handleLogin={handleLogin} />}
      {adminTab === 'ai' && <AdminAIInputView classes={classes} user={user} handleLogin={handleLogin} onComplete={() => setAdminTab('menu')} />}
    </motion.div>
  );
}

function AdminInputView({ classes, user, handleLogin, onBack }: { classes: Class[], user: User | null, handleLogin: () => void, onBack: () => void }) {
    const [selectedClassId, setSelectedClassId] = useState('');
    const [students, setStudents] = useState<Student[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState({ text: '', type: 'success' });

    useEffect(() => {
        if (!selectedClassId) {
            setStudents([]);
            return;
        }
        const fetchStudents = async () => {
            const q = query(collection(db, 'students'), where('classId', '==', selectedClassId));
            const snap = await getDocs(q);
            const sList = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));
            
            // Numeric sort by seat number as requested
            sList.sort((a, b) => {
                const numA = parseInt(a.seatNumber || '0', 10);
                const numB = parseInt(b.seatNumber || '0', 10);
                if (numA !== numB) return numA - numB;
                return a.name.localeCompare(b.name, 'zh-Hant-TW');
            });
            
            setStudents(sList);
            
            const rq = query(collection(db, 'records'), where('classId', '==', selectedClassId), where('date', '==', date));
            const rSnap = await getDocs(rq);
            const rMap: Record<string, number> = {};
            rSnap.docs.forEach(d => {
                const data = d.data();
                rMap[data.studentId] = data.count;
            });
            setCounts(rMap);
        };
        fetchStudents();
    }, [selectedClassId, date]);

    const handleSave = async () => {
        console.log('Saving started for class:', selectedClassId);
        if (!selectedClassId || saving) return;
        
        if (!user && !auth.currentUser) {
            console.error('Still no authenticated user');
            setMsg({ text: '請先點擊頁面頂部的「登入同步」按鈕', type: 'danger' });
            handleLogin(); // Auto-trigger login if they try to save
            return;
        }

        setSaving(true);
        setMsg({ text: '正在準備保存...', type: 'success' });
        try {
            // Fetch all existing records for this class and date at once to optimize
            const q = query(collection(db, 'records'), where('classId', '==', selectedClassId), where('date', '==', date));
            const existingSnap = await getDocs(q);
            const existingRecords: Record<string, number> = {};
            existingSnap.docs.forEach(doc => {
                existingRecords[doc.data().studentId] = doc.data().count;
            });

            const batch = writeBatch(db);
            let hasChanges = false;
            let totalDelta = 0;
            
            for (const student of students) {
                const count = counts[student.id] || 0;
                const prevCount = existingRecords[student.id] || 0;
                const delta = count - prevCount;

                if (delta === 0) continue;
                hasChanges = true;
                totalDelta += delta;

                const recordId = `${student.id}_${date}`;
                const recordRef = doc(db, 'records', recordId);

                batch.set(recordRef, {
                    studentId: student.id,
                    classId: selectedClassId,
                    count: count,
                    date: date,
                    updatedAt: serverTimestamp()
                }, { merge: true });

                const studentRef = doc(db, 'students', student.id);
                batch.update(studentRef, { totalCount: increment(delta) });
            }

            if (hasChanges) {
                const classRef = doc(db, 'classes', selectedClassId);
                batch.update(classRef, { totalCount: increment(totalDelta) });
                
                console.log('Committing batch changes...');
                await batch.commit().catch(err => {
                    handleFSLocalError(err, 'write', 'batch_input_save');
                    throw err;
                });
            } else {
                console.log('No changes detected.');
            }
            
            setMsg({ text: '保存成功！', type: 'success' });
            console.log('Save successful, redirecting...');
            setTimeout(() => {
                onBack();
            }, 600);
        } catch (err) {
            console.error('Save error:', err);
            setMsg({ text: '保存失敗：' + (err instanceof Error ? err.message : '發生未知錯誤'), type: 'danger' });
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="grid gap-8 pb-32">
            {!user && (
                <Card className="bg-rose-500/10 border-rose-500/20 py-10 flex flex-col items-center justify-center text-center">
                    <Globe className="text-rose-500 mb-4 animate-pulse" size={48} />
                    <h3 className="text-xl font-black text-white mb-2">雲端同步未啟用</h3>
                    <p className="text-slate-400 text-sm mb-6 max-w-xs">您必須先登入 Google 帳號，才能將跳繩紀錄儲存至雲端資料庫。</p>
                    <Button onClick={handleLogin} className="bg-indigo-600 hover:bg-indigo-500 px-8 h-12 rounded-2xl">
                        立即登入並同步數據
                    </Button>
                </Card>
            )}

            {user && (
                <>
                    <Card className="bg-indigo-600/10 border-indigo-500/20">
                        <header className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-400">
                                <PlusCircle size={24} />
                            </div>
                            <h3 className="text-xl font-black text-white tracking-tight">快速登記次數 <span className="text-indigo-400">Entry</span></h3>
                        </header>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-[10px] font-black text-indigo-300 uppercase tracking-widest ml-1">選擇班級 Class</label>
                                <select 
                                    value={selectedClassId} 
                                    onChange={(e) => setSelectedClassId(e.target.value)}
                                    className="bg-white/5 border border-white/10 rounded-2xl px-5 py-4 font-bold text-white focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all appearance-none backdrop-blur-xl"
                                >
                                    <option value="" className="bg-slate-900">選擇班級</option>
                                    {classes.map(c => <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>)}
                                </select>
                            </div>
                            <div className="flex flex-col gap-2">
                                <label className="text-[10px] font-black text-indigo-300 uppercase tracking-widest ml-1">選擇日期 Date</label>
                                <input 
                                    type="date" 
                                    value={date} 
                                    onChange={(e) => setDate(e.target.value)}
                                    className="bg-white/5 border border-white/10 rounded-2xl px-5 py-4 font-bold text-white focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all backdrop-blur-xl"
                                />
                            </div>
                        </div>
                    </Card>

                    {students.length > 0 && (
                        <div className="grid gap-4">
                            {students.map(s => (
                                <Card key={s.id} className="p-5 flex items-center justify-between border-white/5 hover:border-white/10 transition-colors">
                                    <div className="flex items-center gap-4">
                                        <div className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center text-xs font-black text-slate-500 ring-1 ring-white/10">
                                            {s.seatNumber || '-'}
                                        </div>
                                        <span className="font-black text-xl text-white tracking-tight">{s.name}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input 
                                            type="number" 
                                            min="0"
                                            value={counts[s.id] || ''} 
                                            onChange={(e) => setCounts({...counts, [s.id]: parseInt(e.target.value) || 0})}
                                            placeholder="0"
                                            className="w-32 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-right font-black text-white focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all placeholder:text-slate-700"
                                        />
                                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">下</span>
                                    </div>
                                </Card>
                            ))}
                            
                            <div className="sticky bottom-0 left-0 right-0 py-6 bg-slate-950/80 backdrop-blur-md z-40">
                                <div className="max-w-2xl mx-auto">
                                    <Button 
                                        className="w-full h-16 rounded-[24px] shadow-2xl shadow-indigo-500/40" 
                                        size="lg" 
                                        onClick={handleSave} 
                                        disabled={saving}
                                    >
                                        {saving ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                                        {saving ? '正在保存紀錄...' : '一鍵確認並保存數據'}
                                    </Button>
                                    <AnimatePresence>
                                        {msg.text && (
                                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cn("text-center mt-3 text-sm font-black", msg.type === 'success' ? 'text-teal-400 shadow-teal-500/20' : 'text-rose-400 shadow-rose-500/20')}>
                                                {msg.text}
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {user && selectedClassId && students.length === 0 && (
                <Card className="py-20 flex flex-col items-center justify-center border-dashed">
                    <Users className="text-slate-700 mb-6" size={64} strokeWidth={1} />
                    <p className="text-slate-500 font-bold tracking-wide">此班級尚無學生，請先至班級管理添加學生。</p>
                </Card>
            )}
        </div>
    );
}

function AdminClassesView({ classes, user, handleLogin, onUpdate }: { classes: Class[], user: User | null, handleLogin: () => void, onUpdate: () => void }) {
    const [newClassName, setNewClassName] = useState('');
    const [newGradeLevel, setNewGradeLevel] = useState<GradeLevel>('Low');
    const [editingClassId, setEditingClassId] = useState<string | null>(null);

    const handleAddClass = async () => {
        if (!newClassName) return;
        try {
            await addDoc(collection(db, 'classes'), {
                name: newClassName,
                gradeLevel: getGradeLevelFromName(newClassName),
                totalCount: 0
            });
            setNewClassName('');
            onUpdate();
        } catch (err) { console.error(err); }
    };

    const downloadTemplate = () => {
        const headers = ['班級', '座號', '姓名'];
        const csvContent = '\uFEFF' + headers.join(',') + '\n' + '四年甲班,1,王小明\n四年甲班,2,李小華';
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `class_student_import_template.csv`);
        link.click();
    };

    const handleBulkImportClassesAndStudents = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            const content = event.target?.result as string;
            const lines = content.split('\n').map(l => l.trim()).filter(l => l);
            try {
                const batch = writeBatch(db);
                // Skip header if it exists
                const dataLines = lines[0].includes('班級') ? lines.slice(1) : lines;
                
                // Track unique classes to create or use
                const uniqueClasses = new Map<string, string>(); // class_name -> doc_id
                
                // First pass: Find or create all classes
                const classSnap = await getDocs(collection(db, 'classes'));
                classSnap.docs.forEach(doc => {
                    uniqueClasses.set(doc.data().name, doc.id);
                });

                for (const line of dataLines) {
                    const [className] = line.split(',').map(s => s.trim());
                    if (className && !uniqueClasses.has(className)) {
                        const classRef = doc(collection(db, 'classes'));
                        uniqueClasses.set(className, classRef.id);
                        batch.set(classRef, {
                            name: className,
                            gradeLevel: getGradeLevelFromName(className),
                            totalCount: 0
                        });
                    }
                }

                // Second pass: Create students
                dataLines.forEach(line => {
                    const [className, seatNumber, studentName] = line.split(',').map(s => s.trim());
                    const classId = uniqueClasses.get(className);
                    if (classId && studentName) {
                        const studentRef = doc(collection(db, 'students'));
                        batch.set(studentRef, {
                            name: studentName,
                            seatNumber: seatNumber || '',
                            classId: classId,
                            totalCount: 0
                        });
                    }
                });
                
                await batch.commit();
                onUpdate();
                alert('班級與學生資料匯入成功！');
            } catch (err) {
                console.error(err);
                alert('匯入失敗，請確認檔案格式');
            }
        };
        reader.readAsText(file);
    };

    const handleDeleteClass = async (id: string) => {
        if (!confirm('確定要刪除班級嗎？此操作不可逆。')) return;
        try {
            await deleteDoc(doc(db, 'classes', id));
            onUpdate();
        } catch (err) { console.error(err); }
    };

    return (
        <div className="grid gap-10">
            {!user && (
                <Card className="bg-rose-500/10 border-rose-500/20 py-10 flex flex-col items-center justify-center text-center">
                    <Globe className="text-rose-500 mb-4 animate-pulse" size={48} />
                    <h3 className="text-xl font-black text-white mb-2">雲端同步未啟用</h3>
                    <p className="text-slate-400 text-sm mb-6 max-w-xs">您必須先登入 Google 帳號，才能管理班級資料。</p>
                    <Button onClick={handleLogin} className="bg-indigo-600 hover:bg-indigo-500 px-8 h-12 rounded-2xl">
                        立即登入並同步數據
                    </Button>
                </Card>
            )}

            {user && (
                <>
                    <Card className="bg-white/5 border-white/10 p-10 rounded-[48px]">
                <div className="flex flex-col gap-6 mb-10">
                    <h3 className="text-2xl font-bold text-slate-200">單筆新增班級</h3>
                    <div className="flex items-center gap-6 pt-2 border-t border-white/10">
                        <button 
                            onClick={downloadTemplate}
                            className="flex items-center gap-2 text-slate-400 hover:text-indigo-400 text-sm font-medium transition-colors"
                        >
                            <Download size={16} /> 下載匯入範本
                        </button>
                        <label className="flex items-center gap-2 text-slate-400 hover:text-indigo-400 text-sm font-medium transition-colors cursor-pointer">
                            <FileText size={16} /> CSV 大量匯入
                            <input type="file" accept=".csv,.txt" onChange={handleBulkImportClassesAndStudents} className="hidden" />
                        </label>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6 mb-10">
                    <input 
                        placeholder="班級名稱 (如：一年一班)" 
                        value={newClassName} 
                        onChange={e => setNewClassName(e.target.value)}
                        className="bg-slate-800/40 border-none rounded-2xl px-5 py-4 font-bold text-slate-200 text-base focus:ring-2 focus:ring-indigo-500/50 outline-none transition-all placeholder:text-slate-500"
                    />
                </div>

                <Button 
                    className="w-full py-4 rounded-2xl text-lg bg-indigo-600 hover:bg-indigo-500 shadow-2xl shadow-indigo-600/40" 
                    onClick={handleAddClass}
                >
                    儲存並更新名單
                </Button>
            </Card>

            <div className="grid gap-4">
                <h3 className="text-sm font-bold text-slate-500 px-4">現有班級清單</h3>
                {classes.map(c => {
                    const isEditing = editingClassId === c.id;
                    return (
                        <Card key={c.id} className={cn(
                            "p-0 border-white/5 overflow-hidden transition-all group",
                            isEditing ? "bg-indigo-50/50 shadow-xl ring-2 ring-indigo-500/10" : "hover:bg-white/5 cursor-pointer bg-white/2"
                        )} onClick={() => setEditingClassId(isEditing ? null : c.id)}>
                            <div className={cn(
                                "p-6 flex items-center justify-between transition-colors",
                                isEditing ? "bg-indigo-50/80 border-b border-indigo-100/50" : ""
                            )}>
                                <h4 className={cn("font-bold text-xl", isEditing ? "text-indigo-600" : "text-slate-200")}>{c.name}</h4>
                                <div className="flex items-center gap-2">
                                    {isEditing ? (
                                        <>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleDeleteClass(c.id); }}
                                                className="text-rose-400 hover:text-rose-600 p-2 hover:bg-rose-100 rounded-xl transition-colors"
                                                title="刪除班級"
                                            >
                                                <Trash2 size={20} />
                                            </button>
                                            <button className="text-indigo-300 hover:text-indigo-500 p-2 hover:bg-indigo-100 rounded-xl transition-colors">
                                                <X size={20} />
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-slate-500 text-sm font-medium mr-2">管理名單</span>
                                            <ChevronRight className="text-slate-600 group-hover:text-slate-400 transition-colors" size={20} />
                                        </>
                                    )}
                                </div>
                            </div>
                            <AnimatePresence>
                                {isEditing && (
                                    <motion.div 
                                        initial={{ height: 0, opacity: 0 }} 
                                        animate={{ height: 'auto', opacity: 1 }} 
                                        exit={{ height: 0, opacity: 0 }} 
                                        className="overflow-hidden bg-[#fcfdfe]"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                         <AdminStudentManager classId={c.id} />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </Card>
                    );
                })}
            </div>
                </>
            )}
        </div>
    );
}

function AdminStudentManager({ classId }: { classId: string }) {
    const [students, setStudents] = useState<Student[]>([]);
    const [name, setName] = useState('');
    const [seatNumber, setSeatNumber] = useState('');
    const [editingStudent, setEditingStudent] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editSeat, setEditSeat] = useState('');

    const fetch = async () => {
        const q = query(collection(db, 'students'), where('classId', '==', classId));
        const snap = await getDocs(q);
        const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));
        // Numeric sort by seat number and locale-aware for names
        data.sort((a, b) => {
            const numA = parseInt(a.seatNumber || '0', 10);
            const numB = parseInt(b.seatNumber || '0', 10);
            if (numA !== numB) return numA - numB;
            return a.name.localeCompare(b.name, 'zh-Hant-TW');
        });
        setStudents(data);
    };

    useEffect(() => { fetch(); }, [classId]);

    const add = async () => {
        if (!name) return;
        try {
            await addDoc(collection(db, 'students'), {
                name,
                seatNumber,
                classId,
                totalCount: 0
            });
            setName('');
            setSeatNumber('');
            fetch();
        } catch (err) { console.error(err); }
    };

    const startEdit = (s: Student) => {
        setEditingStudent(s.id);
        setEditName(s.name);
        setEditSeat(s.seatNumber || '');
    };

    const saveEdit = async (id: string) => {
        try {
            await updateDoc(doc(db, 'students', id), {
                name: editName,
                seatNumber: editSeat
            });
            setEditingStudent(null);
            fetch();
        } catch (err) { console.error(err); }
    };

    const downloadTemplate = () => {
        const headers = ['座號', '學生姓名'];
        const csvContent = '\uFEFF' + headers.join(',') + '\n';
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `student_import_template.csv`);
        link.click();
    };

    const handleBulkImportStudents = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            const content = event.target?.result as string;
            const lines = content.split('\n').map(n => n.trim()).filter(n => n);
            try {
                const batch = writeBatch(db);
                // Skip header if it exists
                const dataLines = lines[0].includes('姓名') || lines[0].includes('座號') ? lines.slice(1) : lines;
                dataLines.forEach(line => {
                    const [seatNumber, studentName] = line.split(',').map(s => s.trim());
                    if (studentName) {
                        const studentRef = doc(collection(db, 'students'));
                        batch.set(studentRef, {
                            name: studentName,
                            seatNumber: seatNumber || '',
                            classId,
                            totalCount: 0
                        });
                    }
                });
                await batch.commit();
                fetch();
                alert('名單匯入成功！');
            } catch (err) {
                console.error(err);
                alert('匯入失敗');
            }
        };
        reader.readAsText(file);
    };

    const remove = async (id: string) => {
        if (!confirm('確認刪除學生？相關數據將會丢失。')) return;
        try {
            await deleteDoc(doc(db, 'students', id));
            fetch();
        } catch (err) { console.error(err); }
    };

    return (
        <div className="p-6 space-y-6">
            {/* Add Student Section */}
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-1">新增學生 Add Student</div>
                <div className="flex gap-2">
                    <input 
                        placeholder="座號" 
                        value={seatNumber} 
                        onChange={e => setSeatNumber(e.target.value)}
                        className="w-14 bg-white border border-slate-200 rounded-xl px-2 py-2 font-bold text-slate-700 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all placeholder:text-slate-300"
                    />
                    <input 
                        placeholder="姓名" 
                        value={name} 
                        onChange={e => setName(e.target.value)}
                        className="flex-1 min-w-0 bg-white border border-slate-200 rounded-xl px-3 py-2 font-bold text-slate-700 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all placeholder:text-slate-300"
                    />
                    <button 
                        onClick={add}
                        className="bg-indigo-600 w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-600/20 hover:scale-105 active:scale-95 transition-all shrink-0"
                    >
                        <Plus size={20} />
                    </button>
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">學生名單 List</div>
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={downloadTemplate}
                            className="flex items-center gap-1.5 text-slate-400 hover:text-indigo-400 text-xs font-medium transition-colors"
                        >
                            <Download size={14} /> 下載範本
                        </button>
                        <label className="flex items-center gap-1.5 text-slate-400 hover:text-indigo-400 text-xs font-medium transition-colors cursor-pointer">
                            <FileText size={14} /> CSV 匯入
                            <input type="file" accept=".csv,.txt" onChange={handleBulkImportStudents} className="hidden" />
                        </label>
                    </div>
                </div>
                
                <div className="space-y-3">
                {students.map((s, index) => (
                    <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.03 }}
                        key={s.id} 
                        className="bg-white border border-slate-100 px-6 py-4 rounded-2xl flex justify-between items-center shadow-sm group hover:shadow-md transition-all"
                    >
                        {editingStudent === s.id ? (
                            <div className="flex-1 flex gap-2">
                                <input 
                                    value={editSeat} 
                                    onChange={e => setEditSeat(e.target.value)}
                                    className="w-16 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-sm font-bold text-slate-700"
                                />
                                <input 
                                    value={editName} 
                                    onChange={e => setEditName(e.target.value)}
                                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1 text-sm font-bold text-slate-700"
                                    autoFocus
                                />
                                <Button onClick={() => saveEdit(s.id)} size="sm" className="h-8">儲存</Button>
                                <Button onClick={() => setEditingStudent(null)} variant="ghost" size="sm" className="h-8">取消</Button>
                            </div>
                        ) : (
                            <>
                                <div className="flex items-center gap-10">
                                    <span className="text-slate-300 font-black italic min-w-[30px]">{s.seatNumber || (index + 1)}</span>
                                    <span className="font-bold text-slate-700 text-lg">{s.name}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button 
                                        onClick={() => startEdit(s)} 
                                        className="text-indigo-400 hover:text-indigo-600 transition-colors p-2 hover:bg-indigo-50 rounded-lg"
                                        title="修改"
                                    >
                                        <Edit2 size={18} />
                                    </button>
                                    <button 
                                        onClick={() => remove(s.id)} 
                                        className="text-rose-400 hover:text-rose-600 transition-colors p-2 hover:bg-rose-50 rounded-lg"
                                        title="刪除"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </>
                        )}
                    </motion.div>
                ))}
            </div>
        </div>
    </div>
    );
}

function AdminExportView({ user, handleLogin }: { user: User | null, handleLogin: () => void }) {
    const handleExport = async () => {
        try {
            const snap = await getDocs(collection(db, 'records'));
            const recs = snap.docs.map(d => d.data());
            
            const headers = ['日期', '班級ID', '學生ID', '次數'];
            let csvContent = '\uFEFF' + headers.join(',') + '\n'; // Add BOM for Excel Chinese support
            
            recs.forEach(r => {
                csvContent += [r.date, r.classId, r.studentId, r.count].join(',') + '\n';
            });

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', `jump_rope_records_${format(new Date(), 'yyyy-MM-dd')}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="flex flex-col gap-6">
            {!user && (
                <Card className="bg-rose-500/10 border-rose-500/20 py-10 flex flex-col items-center justify-center text-center">
                    <Globe className="text-rose-500 mb-4 animate-pulse" size={48} />
                    <h3 className="text-xl font-black text-white mb-2">雲端同步未啟用</h3>
                    <p className="text-slate-400 text-sm mb-6 max-w-xs">您必須先登入 Google 帳號，才能讀取雲端數據進行匯出。</p>
                    <Button onClick={handleLogin} className="bg-indigo-600 hover:bg-indigo-500 px-8 h-12 rounded-2xl">
                        立即登入並發起連線
                    </Button>
                </Card>
            )}

            {user && (
                <Card className="flex flex-col items-center justify-center p-16 bg-white border-slate-100 text-center relative overflow-hidden group shadow-xl">
                    <div className="absolute -top-10 -right-10 w-40 h-40 bg-teal-500/5 blur-[80px] rounded-full group-hover:bg-teal-500/10 transition-all"></div>
                    <div className="w-20 h-20 bg-teal-500/10 text-teal-600 rounded-3xl flex items-center justify-center mb-8 shadow-xl shadow-teal-500/10 border border-teal-500/20 group-hover:scale-110 transition-transform">
                        <Download size={36} />
                    </div>
                    <h3 className="text-2xl font-black text-slate-800 mb-3">數據統計匯出</h3>
                    <p className="text-slate-500 font-medium max-w-xs mx-auto mb-10 leading-relaxed text-sm">將全校紀錄匯出為 CSV 報表，<br/>支持 Excel 直接開啟與行政統計。</p>
                    <Button onClick={handleExport} className="w-full max-w-xs h-14 bg-teal-600 hover:bg-teal-500 shadow-teal-500/20 text-white" size="lg">
                        <Download size={20} />
                        點擊下載 CSV 檔案
                    </Button>
                </Card>
            )}
        </div>
    );
}

function AdminRecordsListView({ classes, user, handleLogin }: { classes: Class[], user: User | null, handleLogin: () => void }) {
    const [groupedRecords, setGroupedRecords] = useState<{
        date: string;
        count: number;
        classNames: string[];
    }[]>([]);
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [confirmingDate, setConfirmingDate] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchAllRecords = async () => {
        setLoading(true);
        setError(null);
        try {
            // Fetch records limited to 2000 for reasonable performance
            const q = query(collection(db, 'records'), orderBy('date', 'desc'), limit(2000));
            const snap = await getDocs(q).catch(err => {
                handleFSLocalError(err, 'get', 'records_grouping');
                throw err;
            });
            
            const groups: Record<string, { count: number; classIds: Set<string> }> = {};
            
            snap.docs.forEach(d => {
                const data = d.data();
                const dKey = data.date;
                if (!dKey) return;
                
                if (!groups[dKey]) {
                    groups[dKey] = { count: 0, classIds: new Set() };
                }
                groups[dKey].count++;
                if (data.classId) groups[dKey].classIds.add(data.classId);
            });

            const classMap = new Map(classes.map(c => [c.id, c.name]));
            const sortedGroups = Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(date => {
                const g = groups[date];
                return {
                    date,
                    count: g.count,
                    classNames: Array.from(g.classIds).map(id => classMap.get(id) || '未知班級')
                };
            });

            setGroupedRecords(sortedGroups);
        } catch (err) {
            console.error('Fetch Records Error:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAllRecords();
    }, [classes]);

    const handleDeleteDate = async (date: string) => {
        console.log('Starting delete for date:', date);
        setDeleting(true);
        setError(null);
        try {
            const q = query(collection(db, 'records'), where('date', '==', date));
            const snap = await getDocs(q).catch(err => {
                handleFSLocalError(err, 'get', `records_delete_${date}`);
                throw err;
            });
            
            if (snap.empty) {
                console.warn('No records found for date:', date);
                setError('找不到該日期的紀錄。');
                setDeleting(false);
                setConfirmingDate(null);
                return;
            }

            const docs = snap.docs;
            console.log(`Found ${docs.length} records. Preparing deletion batches...`);
            
            // To ensure we don't break student/class totals, we need to carefully decrement them.
            // Aggregating updates to minimize batch operations and potential conflicts.
            const studentUpdates: Record<string, number> = {};
            const classUpdates: Record<string, number> = {};
            
            const recordRefs: any[] = [];

            docs.forEach(d => {
                const data = d.data();
                const count = data.count || 0;
                const studentId = data.studentId;
                const classId = data.classId;

                if (studentId) studentUpdates[studentId] = (studentUpdates[studentId] || 0) + count;
                if (classId) classUpdates[classId] = (classUpdates[classId] || 0) + count;
                recordRefs.push(d.ref);
            });

            // Process records in batches of 400 (safe limit considering we might have many records)
            const chunkSize = 400;
            for (let i = 0; i < recordRefs.length; i += chunkSize) {
                const chunk = recordRefs.slice(i, i + chunkSize);
                const batch = writeBatch(db);
                chunk.forEach(ref => batch.delete(ref));
                await batch.commit();
            }

            // Separately update student and class counts to handle them more gracefully
            // Students
            const studentIds = Object.keys(studentUpdates);
            const studentBatchSize = 100;
            for (let i = 0; i < studentIds.length; i += studentBatchSize) {
                const ids = studentIds.slice(i, i + studentBatchSize);
                const batch = writeBatch(db);
                ids.forEach(id => {
                    const delta = studentUpdates[id];
                    batch.update(doc(db, 'students', id), { totalCount: increment(-delta) });
                });
                await batch.commit().catch(err => {
                    console.warn('Silent failure on student count update (might be deleted student):', err);
                    // We don't throw here to avoid stopping the whole process, as records are already deleted
                });
            }

            // Classes
            const classIds = Object.keys(classUpdates);
            const classBatchSize = 100;
            for (let i = 0; i < classIds.length; i += classBatchSize) {
                const ids = classIds.slice(i, i + classBatchSize);
                const batch = writeBatch(db);
                ids.forEach(id => {
                    const delta = classUpdates[id];
                    batch.update(doc(db, 'classes', id), { totalCount: increment(-delta) });
                });
                await batch.commit().catch(err => {
                    console.warn('Silent failure on class count update:', err);
                });
            }
            
            console.log('Deletion successful');
            setConfirmingDate(null);
            fetchAllRecords();
        } catch (err) {
            console.error('Delete Date Error:', err);
            setError('刪除失敗：' + (err instanceof Error ? err.message : '發生未知錯誤'));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="space-y-6">
            {!user && (
                <Card className="bg-rose-500/10 border-rose-500/20 py-10 flex flex-col items-center justify-center text-center">
                    <Globe className="text-rose-500 mb-4 animate-pulse" size={48} />
                    <h3 className="text-xl font-black text-white mb-2">雲端同步未啟用</h3>
                    <p className="text-slate-400 text-sm mb-6 max-w-xs">您必須先登入 Google 帳號，才能讀取雲端紀錄量。</p>
                    <Button onClick={handleLogin} className="bg-indigo-600 hover:bg-indigo-500 px-8 h-12 rounded-2xl">
                        立即登入並同步數據
                    </Button>
                </Card>
            )}

            {user && (
                <>
                    <div className="bg-amber-50/10 border border-amber-500/20 rounded-2xl p-4 flex items-start gap-3">
                        <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="text-sm text-amber-200/80 font-medium leading-relaxed">
                                此處可查看所有已儲存的日期紀錄。
                            </p>
                            {error && (
                                <p className="mt-2 text-sm text-rose-400 font-bold bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
                                    {error}
                                </p>
                            )}
                        </div>
                    </div>

            {loading ? (
                <div className="py-20 flex flex-col items-center gap-4">
                    <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
                    <p className="text-slate-500 font-bold">載入紀錄中...</p>
                </div>
            ) : groupedRecords.length > 0 ? (
                <div className="grid gap-4">
                    {groupedRecords.map(group => (
                        <Card key={group.date} className="p-6 border-white/5 bg-white/2 hover:border-white/10 transition-all group relative overflow-hidden">
                            <div className="flex items-center justify-between relative z-10">
                                <div className="space-y-2">
                                    <h4 className="text-2xl font-black text-white tracking-tight">{group.date}</h4>
                                    <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-2 text-slate-400 font-bold text-sm">
                                            <span>共 {group.count} 筆資料</span>
                                            <span className="text-xs font-black text-slate-600 uppercase tracking-widest bg-white/5 px-2 py-0.5 rounded">
                                                RECORDED
                                            </span>
                                        </div>
                                        <p className="text-indigo-400/80 text-sm font-medium">
                                            ({group.classNames.length > 0 ? group.classNames.join(', ') : '無班級資料'})
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {confirmingDate === group.date ? (
                                        <div className="flex items-center gap-2 bg-rose-500/10 p-1 rounded-xl border border-rose-500/20">
                                            <span className="text-[10px] font-black text-rose-400 uppercase px-2">確定刪除?</span>
                                            <button 
                                                onClick={() => handleDeleteDate(group.date)}
                                                disabled={deleting}
                                                className="bg-rose-600 text-white px-3 py-2 rounded-lg text-xs font-black hover:bg-rose-500 transition-colors"
                                            >
                                                {deleting ? '...' : 'YES'}
                                            </button>
                                            <button 
                                                onClick={() => setConfirmingDate(null)}
                                                disabled={deleting}
                                                className="bg-white/10 text-white px-3 py-2 rounded-lg text-xs font-black hover:bg-white/20 transition-colors"
                                            >
                                                NO
                                            </button>
                                        </div>
                                    ) : (
                                        <motion.button 
                                            whileHover={{ scale: 1.1 }}
                                            whileTap={{ scale: 0.9 }}
                                            onClick={() => setConfirmingDate(group.date)}
                                            disabled={deleting}
                                            className="w-12 h-12 flex items-center justify-center text-red-500 hover:bg-red-500/10 rounded-xl transition-all disabled:opacity-50"
                                        >
                                            <Trash2 size={24} />
                                        </motion.button>
                                    )}
                                </div>
                            </div>
                        </Card>
                    ))}
                    <p className="text-[10px] text-center text-slate-600 font-black uppercase tracking-widest pt-4">
                        --- END OF RECORDS ---
                    </p>
                </div>
            ) : (
                <div className="py-20 flex flex-col items-center gap-4 border-2 border-dashed border-white/5 rounded-3xl">
                    <History size={48} className="text-slate-700" />
                    <p className="text-slate-500 font-bold italic">目前尚無任何日期紀錄</p>
                </div>
            )}
                </>
            )}
        </div>
    );
}

function AdminAIInputView({ classes, user, handleLogin, onComplete }: { classes: Class[], user: User | null, handleLogin: () => void, onComplete?: () => void }) {
    const isCvReady = useOpenCV();
    const [selectedClassId, setSelectedClassId] = useState('');
    const [image, setImage] = useState<string | null>(null);
    const [scanning, setScanning] = useState(false);
    const [saving, setSaving] = useState(false);
    const [students, setStudents] = useState<Student[]>([]);
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [scanSessionIndex, setScanSessionIndex] = useState(0);
    const [showVerify, setShowVerify] = useState(false);
    const [scanConfirmResult, setScanConfirmResult] = useState<number[] | null>(null);
    const [scanTargetDate, setScanTargetDate] = useState(date);
    const [scanMultiplier, setScanMultiplier] = useState<50 | 100>(100);
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const SESSIONS = ["第一週", "第二週", "第三週", "第四週"];

    useEffect(() => {
        if (!selectedClassId) return;
        const fetchStudents = async () => {
            const q = query(collection(db, 'students'), where('classId', '==', selectedClassId), orderBy('seatNumber', 'asc'));
            const snap = await getDocs(q);
            const fetched = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));
            fetched.sort((a, b) => {
                const numA = parseInt(a.seatNumber || '0', 10);
                const numB = parseInt(b.seatNumber || '0', 10);
                if (numA !== numB) return numA - numB;
                return a.name.localeCompare(b.name, 'zh-Hant-TW');
            });
            setStudents(fetched);
        };
        fetchStudents();
    }, [selectedClassId]);

    const analyzeLaps = (warped: any) => {
        const cv = (window as any).cv;
        const ROWS = 25, COLS = 8;
        let debugMat = warped.clone();
        let gray = new cv.Mat();
        cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY, 0);
        cv.threshold(gray, gray, 120, 255, cv.THRESH_BINARY_INV);

        const startX_Ratio = 0.183;
        const startY_Ratio = 0.105;
        const endY_Ratio = 0.874;
        const sessionW_Ratio = 0.169;
        const sessionGap = 0.023;

        const gridStartX = warped.cols * (startX_Ratio + (scanSessionIndex * (sessionW_Ratio + sessionGap)));
        const gridStartY = warped.rows * startY_Ratio;
        const gridTotalHeight = warped.rows * (endY_Ratio - startY_Ratio);

        const cellW = (warped.cols * sessionW_Ratio) / COLS;
        const cellH = gridTotalHeight / ROWS;

        let results = [];
        for (let i = 0; i < ROWS; i++) {
            let lastLap = 0;
            for (let j = 0; j < COLS; j++) {
                const sampleSize = 0.28;
                const offset = (1 - sampleSize) / 2;

                let x = Math.floor(gridStartX + (j * cellW) + (cellW * offset));
                let y = Math.floor(gridStartY + (i * cellH) + (cellH * offset));
                let w = Math.floor(cellW * sampleSize);
                let h = Math.floor(cellH * sampleSize);

                let rect = new cv.Rect(x, y, w, h);
                let cell = gray.roi(rect);
                let density = (cv.countNonZero(cell) / (rect.width * rect.height)) * 100;

                let isMarked = density > 10;
                if (isMarked) lastLap = j + 1;

                let color = isMarked ? new cv.Scalar(0, 255, 0, 255) : new cv.Scalar(255, 0, 0, 255);
                cv.rectangle(debugMat, new cv.Point(x, y), new cv.Point(x + w, y + h), color, 2);
                cell.delete();
            }
            results.push(lastLap);
        }

        gray.delete();
        return { results, debugMat };
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !isCvReady || !selectedClassId) {
            if (!selectedClassId) alert("請先選擇班級");
            return;
        }

        setScanning(true);
        setScanTargetDate(date);

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = async () => {
                const cv = (window as any).cv;
                let src = cv.imread(img);
                let warped = new cv.Mat();
                cv.resize(src, warped, new cv.Size(800, 1000));
                const { results, debugMat } = analyzeLaps(warped);
                setScanConfirmResult(results);
                setScanning(false);
                setShowVerify(true);
                
                setTimeout(() => {
                    if (canvasRef.current) {
                        cv.imshow(canvasRef.current, debugMat);
                    }
                    src.delete();
                    warped.delete();
                    debugMat.delete();
                }, 100);
            };
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    const handleSave = async () => {
        if (!selectedClassId || !scanConfirmResult || saving) return;
        
        if (!user && !auth.currentUser) {
            alert('請先登入 Google 帳號以啟用雲端同步功能');
            handleLogin();
            return;
        }

        setSaving(true);
        try {
            const batch = writeBatch(db);
            const targetSession = SESSIONS[scanSessionIndex];
            const multiplier = scanMultiplier; // Use the multiplier selected during scanning
            
            // Optimization: Fetch all existing records for this class/date/session in one go
            const q = query(
                collection(db, 'records'),
                where('classId', '==', selectedClassId),
                where('date', '==', scanTargetDate),
                where('session', '==', targetSession)
            );
            const existingRecordsSnap = await getDocs(q).catch(err => {
                handleFSLocalError(err, 'get', `records/${selectedClassId}/${scanTargetDate}/${targetSession}`);
                throw err;
            });
            const existingCountsMap: Record<string, number> = {};
            existingRecordsSnap.docs.forEach(docSnap => {
                const data = docSnap.data();
                existingCountsMap[data.studentId] = data.count || 0;
            });
            
            let totalDelta = 0;
            
            for (let i = 0; i < students.length; i++) {
                const student = students[i];
                const count = (scanConfirmResult[i] || 0) * multiplier;
                
                const prevCount = existingCountsMap[student.id] || 0;
                const delta = count - prevCount;
                
                if (delta === 0) continue; 

                const recordId = `${student.id}_${scanTargetDate}_${targetSession.replace(/\(|\)/g, '_')}`;
                const recordRef = doc(db, 'records', recordId);
                
                totalDelta += delta;

                batch.set(recordRef, {
                    studentId: student.id,
                    classId: selectedClassId,
                    count: count,
                    date: scanTargetDate,
                    session: targetSession,
                    createdAt: serverTimestamp(),
                    source: 'AI_SCAN'
                }, { merge: true });

                const studentRef = doc(db, 'students', student.id);
                batch.update(studentRef, { totalCount: increment(delta) });
            }

            if (totalDelta !== 0) {
                const classRef = doc(db, 'classes', selectedClassId);
                batch.update(classRef, { totalCount: increment(totalDelta) });
            }

            await batch.commit().catch(err => {
                handleFSLocalError(err, 'write', 'batch_ai_scan_save');
                throw err;
            });
            alert('AI 辨識數據已成功保存！');
            setScanConfirmResult(null);
            setShowVerify(false);
            if (onComplete) onComplete();
        } catch (err) {
            console.error('Save Error:', err);
            // If the error message is our JSON, the alert will show it (or part of it)
            alert('儲存失敗：' + (err instanceof Error ? err.message : '發生未知錯誤'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6 pb-20">
            {!user && (
                <Card className="bg-rose-500/10 border-rose-500/20 py-10 flex flex-col items-center justify-center text-center">
                    <Globe className="text-rose-500 mb-4 animate-pulse" size={48} />
                    <h3 className="text-xl font-black text-white mb-2">雲端同步未啟用</h3>
                    <p className="text-slate-400 text-sm mb-6 max-w-xs">您必須先登入 Google 帳號，才能將辨識結果儲存至雲端。</p>
                    <Button onClick={handleLogin} className="bg-indigo-600 hover:bg-indigo-500 px-8 h-12 rounded-2xl">
                        立即登入並同步數據
                    </Button>
                </Card>
            )}

            {user && (
                <>
                    <Card className="bg-indigo-600/10 border-indigo-500/20 rounded-[32px]">
                <header className="flex items-center gap-3 mb-8">
                    <div className="w-12 h-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-400">
                        <Camera size={28} />
                    </div>
                    <div className="flex flex-col">
                        <h3 className="text-2xl font-black text-white tracking-tight italic">AI 掃描辨識 <span className="text-indigo-400 font-normal not-italic opacity-50 ml-1">v2.0</span></h3>
                    </div>
                </header>

                <div className="space-y-6">
                    <div className="flex flex-col gap-3">
                        <label className="text-[10px] font-black text-indigo-300 uppercase tracking-[0.2em] ml-1">選擇班級 CLASS</label>
                        <select 
                            value={selectedClassId} 
                            onChange={(e) => setSelectedClassId(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 font-bold text-white outline-none appearance-none backdrop-blur-xl shadow-inner"
                        >
                            <option value="" className="bg-slate-900">選擇班級...</option>
                            {classes.map(c => <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>)}
                        </select>
                    </div>

                    <div className="bg-indigo-50/10 p-4 rounded-2xl border border-indigo-500/20 shadow-inner">
                        <label className="block text-center text-[10px] font-black text-indigo-300 uppercase tracking-[0.2em] mb-4 italic underline decoration-indigo-200 underline-offset-4">
                            選擇紙本辨識欄位 (SESSION)
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {SESSIONS.map((label, index) => (
                                <button 
                                    key={index}
                                    onClick={() => setScanSessionIndex(index)}
                                    className={cn(
                                        "py-4 rounded-2xl font-bold text-xs transition-all border shadow-sm",
                                        scanSessionIndex === index 
                                            ? "bg-indigo-600 border-indigo-500 text-white shadow-indigo-600/20 scale-105" 
                                            : "bg-white/5 border-white/5 text-white/40 hover:bg-white/10"
                                    )}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </Card>

            {!isCvReady && (
                <div className="bg-amber-50/10 text-amber-400 p-3 text-[10px] text-center rounded-xl font-bold animate-pulse flex items-center justify-center gap-2 border border-amber-500/20">
                    <Loader2 className="animate-spin" size={14} /> ⏳ 影像辨識模組載入中，請稍候...
                </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-4">
                <button 
                    onClick={() => {
                        setScanMultiplier(50);
                        fileInputRef.current?.click();
                    }}
                    className={cn(
                        "flex items-center justify-center gap-2 py-4 rounded-3xl text-sm font-black transition-all shadow-lg active:scale-95 border-b-4",
                        scanMultiplier === 50 ? 'bg-indigo-600 border-indigo-800 text-white' : 'bg-white/5 border-white/10 text-slate-500'
                    )}
                >
                    <Camera size={18} />
                    📸 掃描低年級
                </button>
                <button 
                    onClick={() => {
                        setScanMultiplier(100);
                        fileInputRef.current?.click();
                    }}
                    className={cn(
                        "flex items-center justify-center gap-2 py-4 rounded-3xl text-sm font-black transition-all shadow-lg active:scale-95 border-b-4",
                        scanMultiplier === 100 ? 'bg-slate-900 border-slate-700 text-white' : 'bg-white/5 border-white/10 text-slate-400'
                    )}
                >
                    <Scan size={18} className="text-teal-400" />
                    📠 掃描中高年級
                </button>
            </div>

            <div className="relative group hidden">
                <input 
                    type="file" 
                    accept="image/*" 
                    ref={fileInputRef}
                    capture="environment"
                    onChange={handleFileUpload}
                    id="ai-upload" 
                    disabled={!isCvReady || scanning || !selectedClassId}
                />
            </div>

            {isCvReady && selectedClassId && (
                <div className="flex flex-col items-center justify-center py-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 mb-6">
                    <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-1">當前倍率模式 Current Multiplier</p>
                    <div className="flex items-center gap-2">
                        <span className={cn("text-lg font-black italic", scanMultiplier === 50 ? "text-amber-400" : "text-teal-400")}>
                            {scanMultiplier === 50 ? "低年級 (x50)" : "中高年級 (x100)"}
                        </span>
                    </div>
                </div>
            )}

            {scanning && (
                <div className="text-center py-6">
                    <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin inline-block"></div>
                    <p className="text-indigo-400 font-black text-[10px] mt-2 uppercase italic">AI Density Checking...</p>
                </div>
            )}

            {/* Verification Modal */}
            <AnimatePresence>
                {showVerify && scanConfirmResult && (
                    <motion.div 
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-50 bg-[#0f172a]/95 backdrop-blur-md flex flex-col pt-4 overflow-hidden"
                    >
                        <header className="p-6 border-b border-white/5 bg-slate-900/40 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-400">
                                    <Search size={24} />
                                </div>
                                <div>
                                    <h2 className="text-xl font-black text-white italic uppercase">Verify Result</h2>
                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest italic">請確認紅綠框是否對準數字格子</p>
                                </div>
                            </div>
                            <button onClick={() => setShowVerify(false)} className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center text-slate-400 hover:bg-white/10 transition-colors">
                                <X size={24} />
                            </button>
                        </header>

                        <div className="flex-1 overflow-y-auto p-6 space-y-8 bg-slate-950 no-scrollbar pb-32">
                            {/* Date Picker for Scan */}
                            <div className="bg-indigo-600/10 border border-indigo-500/20 rounded-3xl p-4 flex items-center justify-between shadow-sm">
                                <div>
                                    <label className="block text-[10px] font-black text-indigo-400 uppercase tracking-widest italic mb-1">歸檔日期 (Date)</label>
                                    <div className="text-[10px] text-indigo-300/50 font-bold">目前欄位：{SESSIONS[scanSessionIndex]}</div>
                                </div>
                                <input 
                                    type="date" 
                                    value={scanTargetDate}
                                    onChange={(e) => setScanTargetDate(e.target.value)}
                                    className="p-2.5 border border-indigo-500/20 rounded-xl text-xs font-black bg-slate-900 text-indigo-100 shadow-inner outline-none"
                                />
                            </div>

                            {/* Canvas for Verification */}
                            <div className="bg-black rounded-3xl overflow-hidden shadow-2xl border-4 border-indigo-500/20 max-w-sm mx-auto">
                                <canvas ref={canvasRef} className="w-full h-auto block rounded-2xl" />
                            </div>

                            <div className="space-y-4">
                                <div className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-2">辨識數據校正 (Correction)</div>
                                <div className="grid gap-3">
                                    {scanConfirmResult.map((laps, index) => (
                                        <motion.div 
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: index * 0.03 }}
                                            key={index} 
                                            className="bg-white/5 border border-white/5 p-4 rounded-[24px] shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4"
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center text-[10px] font-black text-slate-500 ring-1 ring-white/10 shrink-0">
                                                    {students[index]?.seatNumber || (index + 1)}
                                                </div>
                                                <span className="font-black text-lg text-white tracking-tight italic uppercase">{students[index]?.name || `學生 ${index + 1}`}</span>
                                            </div>
                                            
                                            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
                                                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                                                    <button 
                                                        key={n} 
                                                        onClick={() => {
                                                            const newRes = [...scanConfirmResult];
                                                            newRes[index] = n;
                                                            setScanConfirmResult(newRes);
                                                        }}
                                                        className={cn(
                                                            "min-w-[2.2rem] h-9 rounded-xl text-[10px] font-black transition-all",
                                                            laps === n ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/30 scale-110 ring-2 ring-white/20' : 'bg-white/5 text-slate-500 font-bold'
                                                        )}
                                                    >
                                                        {n === 0 ? 'X' : n}
                                                    </button>
                                                ))}
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="p-6 bg-slate-900 border-t border-white/5 grid grid-cols-2 gap-4 shadow-2xl absolute bottom-0 inset-x-0">
                            <button 
                                onClick={() => setShowVerify(false)}
                                className="py-5 bg-white/5 text-slate-400 rounded-2xl font-black text-xs uppercase tracking-widest italic"
                            >
                                Discard
                            </button>
                            <button 
                                onClick={handleSave}
                                disabled={saving}
                                className={cn(
                                    "py-5 rounded-2xl font-black text-xs shadow-xl uppercase tracking-widest italic transition flex items-center justify-center gap-2",
                                    saving ? "bg-slate-700 text-slate-500 cursor-not-allowed" : "bg-indigo-600 text-white shadow-indigo-600/30 active:scale-95"
                                )}
                            >
                                {saving ? (
                                    <>
                                        <Loader2 className="animate-spin" size={18} /> Saving...
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle size={18} /> Confirm & Save
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
                </>
            )}
        </div>
    );
}

