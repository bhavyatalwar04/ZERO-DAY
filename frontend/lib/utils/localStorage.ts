import { createClient } from '@/lib/supabase/client'

export interface UserStats {
    xp: number;
    level: number;
    streak: number;
    lastActiveDate: string | null;
    completedScenarios: { id: string; score: number; date: string }[];
    accuracyHistory: number[];
    unlockedBadges: string[];
    knowledgeLevel: 'Beginner' | 'Intermediate' | 'Advanced' | null;
}

export interface StoredUser {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    stats: UserStats;
}

const STORAGE_KEY = 'zdm_user_v2';
const LEVELS = [0, 500, 1500, 3000, 6000, 10000, 20000];

export const RANKS = [
    [0, 'Novice Trader'],
    [10, 'Junior Analyst'],
    [25, 'Market Observer'],
    [50, 'Trading Specialist'],
    [100, 'Senior Analyst'],
    [200, 'Market Expert'],
    [500, 'Master Trader']
] as const;

export function getRankName(scenarioCount: number): string {
    let currentRank: string = RANKS[0][1];
    for (const [milestone, rankName] of RANKS) {
        if (scenarioCount >= milestone) {
            currentRank = rankName;
        }
    }
    return currentRank;
}

export function calculateLevel(xp: number): number {
    let level = 1;
    for (let i = 0; i < LEVELS.length; i++) {
        if (xp >= LEVELS[i]) {
            level = i + 1;
        } else {
            break;
        }
    }
    return Math.min(level, LEVELS.length);
}

export function getXpProgress(xp: number, level: number) {
    const currentLevelBase = LEVELS[level - 1] || 0;
    const nextLevelBase = LEVELS[level] || LEVELS[LEVELS.length - 1];
    const currentLevelXP = xp - currentLevelBase;
    const nextLevelXP = nextLevelBase - currentLevelBase;
    const progressPercent = nextLevelXP === 0 ? 100 : Math.min(100, Math.max(0, (currentLevelXP / nextLevelXP) * 100));
    
    return {
        currentLevelXP,
        nextLevelXP,
        progressPercent
    };
}

export const defaultStats: UserStats = {
    xp: 0,
    level: 1,
    streak: 0,
    lastActiveDate: null,
    completedScenarios: [],
    accuracyHistory: [],
    unlockedBadges: [],
    knowledgeLevel: null,
};

// ==========================================
// LocalStorage Operations
// ==========================================

export function getUser(): StoredUser | null {
    if (typeof window === 'undefined') return null;
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (!data) return null;
        return JSON.parse(data) as StoredUser;
    } catch {
        return null;
    }
}

export function saveUser(user: StoredUser) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));

    try {
        const supabase = createClient()
        if (supabase && supabase.auth && supabase.auth.getSession) {
            supabase.auth.getSession().then(({ data: { session } }: any) => {
                if (session?.user) {
                    const remoteStats = session.user.user_metadata?.stats
                    const localStats = user.stats

                    if (JSON.stringify(remoteStats) !== JSON.stringify(localStats)) {
                        supabase.auth.updateUser({
                            data: {
                                first_name: user.firstName,
                                last_name: user.lastName,
                                stats: user.stats
                            }
                        })
                    }
                }
            })
        }
    } catch {
        // Safe catch-all fallback
    }
}

export function initUser(authData: { id: string; email: string; firstName: string; lastName: string }): StoredUser {
    const existing = getUser();
    if (existing && existing.id === authData.id) {
        return existing;
    }
    
    const newUser: StoredUser = {
        ...authData,
        stats: { ...defaultStats },
    };
    saveUser(newUser);
    return newUser;
}

export function updateXP(amount: number): StoredUser | null {
    const user = getUser();
    if (!user) return null;

    user.stats.xp += amount;
    user.stats.level = calculateLevel(user.stats.xp);
    saveUser(user);
    return user;
}

export function updateStreak(): StoredUser | null {
    const user = getUser();
    if (!user) return null;

    const todayStr = new Date().toISOString().split('T')[0];
    const lastActive = user.stats.lastActiveDate;

    if (!lastActive) {
        user.stats.streak = 1;
        user.stats.lastActiveDate = todayStr;
    } else if (lastActive !== todayStr) {
        const lastDate = new Date(lastActive);
        const todayDate = new Date(todayStr);
        const diffDays = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
            user.stats.streak += 1;
        } else {
            user.stats.streak = 1; // reset gap
        }
        user.stats.lastActiveDate = todayStr;
    }
    
    saveUser(user);
    return user;
}

export function addCompletedScenario(scenarioId: string, score: number, accuracy: number): { user: StoredUser, newBadges: string[] } | null {
    let user = getUser();
    if (!user) return null;

    // Check if duplicate (allow replays to add XP but not duplicate badges/scenarios)
    const isDuplicate = user.stats.completedScenarios.some(s => s.id === scenarioId);

    if (!isDuplicate) {
        user.stats.completedScenarios.push({
            id: scenarioId,
            score,
            date: new Date().toISOString()
        });
        user.stats.accuracyHistory.push(accuracy);
    }
    
    saveUser(user);
    
    // Check badges
    const newBadges = checkBadgeUnlocks(user);
    if (newBadges.length > 0) {
        user.stats.unlockedBadges.push(...newBadges);
        saveUser(user);
    }

    return { user, newBadges };
}

export function checkBadgeUnlocks(user: StoredUser): string[] {
    const newBadges: string[] = [];
    const currentlyUnlocked = new Set(user.stats.unlockedBadges);
    
    const addBadge = (id: string) => {
        if (!currentlyUnlocked.has(id)) {
            newBadges.push(id);
        }
    };

    // 1. First Trade
    if (user.stats.completedScenarios.length >= 1) {
        addBadge('first-trade');
    }
    
    // 2. First Correct
    if (user.stats.accuracyHistory.length > 0 && user.stats.accuracyHistory[user.stats.accuracyHistory.length - 1] > 50) {
        addBadge('first-correct');
    }

    // 3. Streak 7
    if (user.stats.streak >= 7) {
        addBadge('streak-7');
    }

    // 4. 10 Scenarios
    if (user.stats.completedScenarios.length >= 10) {
        addBadge('10-scenarios');
    }

    // 5. Crash Direction
    if (user.stats.completedScenarios.some(s => s.id === 'lehman-2008' && s.score > 0)) {
        addBadge('crash-direction');
    }

    return newBadges;
}

export function setKnowledgeLevel(level: 'Beginner' | 'Intermediate' | 'Advanced'): StoredUser | null {
    const user = getUser();
    if (!user) return null;
    user.stats.knowledgeLevel = level;
    saveUser(user);
    return user;
}

// ==========================================
// Portfolio Run Storage
// ==========================================

const PORTFOLIO_RUN_KEY = 'portfolio_run'

export function savePortfolioRun(slug: string, result: unknown): void {
    if (typeof window === 'undefined') return
    try {
        localStorage.setItem(`${PORTFOLIO_RUN_KEY}_${slug}`, JSON.stringify(result))
    } catch { /* storage full or unavailable */ }
}

export function loadPortfolioRun<T = unknown>(slug: string): T | null {
    if (typeof window === 'undefined') return null
    try {
        const data = localStorage.getItem(`${PORTFOLIO_RUN_KEY}_${slug}`)
        return data ? (JSON.parse(data) as T) : null
    } catch {
        return null
    }
}
