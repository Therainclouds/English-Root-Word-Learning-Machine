'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_LEARNING,
  DEFAULT_PROFILE,
  USER_STORES,
  cardsRepo,
  deleteUserDb,
  getDb,
  learningRepo,
  passagesRepo,
  sentencesRepo,
  migrateLegacyData,
  migrateUserContentToShared,
  pathRepo,
  profileRepo,
  reviewRepo,
  settingsRepo,
  wordsRepo,
} from './db';
import { ensurePassagesSeeded, ensureSeeded } from './data/seed';
import { setLlmUser } from './llm/telemetry';
import { buildSession, createInitialState, schedule } from './srs';
import { computeKnownFamilies, computeRuntime } from './path';
import { estimateCoverage } from './coverage';
import { todayKey } from './utils';
import {
  createUser,
  ensureUsers,
  removeUserRecord,
  renameUser,
  setActiveUserId,
  type UserAccount,
} from './users';
import type {
  Card,
  GlobalSettings,
  LearningConfig,
  Passage,
  PathNode,
  ReviewLog,
  ReviewState,
  Sentence,
  Settings,
  UserProfile,
  Word,
  WordFamily,
} from './types';

export function useApp() {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [families, setFamilies] = useState<WordFamily[]>([]);
  const [words, setWords] = useState<Word[]>([]);
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [nodes, setNodes] = useState<PathNode[]>([]);
  const [states, setStates] = useState<ReviewState[]>([]);
  const [logs, setLogs] = useState<ReviewLog[]>([]);
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);

  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>(DEFAULT_GLOBAL_SETTINGS);
  const [learning, setLearning] = useState<LearningConfig>(DEFAULT_LEARNING);

  /** 全局配置 + 该用户的学习参数 */
  const settings: Settings = useMemo(
    () => ({ ...globalSettings, learning }),
    [globalSettings, learning],
  );

  useEffect(() => {
    const { users: list, activeId } = ensureUsers();
    setUsers(list);
    setUserId(activeId);
    setGlobalSettings(settingsRepo.load());
  }, []);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      await migrateLegacyData(userId);
      await migrateUserContentToShared(userId);
      await ensureSeeded();
      await ensurePassagesSeeded();

      const [f, w, s, c, n, pg] = await Promise.all([
        wordsRepo.allFamilies(),
        wordsRepo.allWords(),
        sentencesRepo.all(),
        cardsRepo.all(),
        pathRepo.all(),
        passagesRepo.all(),
      ]);
      const [st, lg, prof, learn] = await Promise.all([
        reviewRepo.all(userId),
        reviewRepo.logs(userId),
        profileRepo.get(userId),
        learningRepo.get(userId),
      ]);

      setFamilies(f);
      setWords(w);
      setSentences(s);
      setCards(c);
      setNodes(n);
      setPassages(pg);
      setStates(st);
      setLogs(lg);
      setProfile(prof);
      setLearning(learn);
      setLoadError(null);
      setReady(true);
    } catch (err) {
      // 把失败暴露到界面上，而不是永远停在"准备中"
      setLoadError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      setReady(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // LLM 调用记录写入当前用户（S-005）
  useEffect(() => {
    setLlmUser(userId);
    return () => setLlmUser(null);
  }, [userId]);

  const stateMap = useMemo(() => new Map(states.map((s) => [s.cardId, s])), [states]);
  const sentenceMap = useMemo(() => new Map(sentences.map((s) => [s.id, s])), [sentences]);
  const wordMap = useMemo(() => new Map(words.map((w) => [w.id, w])), [words]);

  const known = useMemo(() => computeKnownFamilies(families, cards, stateMap), [families, cards, stateMap]);
  const coverage = useMemo(() => estimateCoverage(families, known), [families, known]);
  const runtime = useMemo(() => computeRuntime(nodes, cards, stateMap), [nodes, cards, stateMap]);

  const dueCount = useMemo(() => {
    const now = Date.now();
    return states.filter((s) => s.reps > 0 && s.dueAt <= now).length;
  }, [states]);

  const learnedToday = useMemo(() => {
    const key = todayKey();
    return logs.filter((l) => todayKey(new Date(l.reviewedAt)) === key).length;
  }, [logs]);

  const session = useMemo(
    () =>
      buildSession({
        cards,
        states: stateMap,
        newLimit: learning.dailyNewLimit,
        learnedToday: learnedToday / 2,
      }),
    [cards, stateMap, learning.dailyNewLimit, learnedToday],
  );

  const grade = useCallback(
    async (card: Card, value: number) => {
      if (!userId) return;
      const current = stateMap.get(card.id) ?? createInitialState(card);
      const next = schedule(current, value);
      await reviewRepo.put(userId, next);
      await reviewRepo.log(userId, {
        cardId: card.id,
        reviewedAt: Date.now(),
        grade: value,
        direction: card.direction,
      });

      const key = todayKey();
      const heatmap = { ...profile.heatmap, [key]: (profile.heatmap[key] ?? 0) + 1 };
      const keepsStreak = profile.lastStudyDate === todayKey(new Date(Date.now() - 86400000))
        || profile.lastStudyDate === key;

      const nextProfile: UserProfile = {
        ...profile,
        heatmap,
        dailyStreak: keepsStreak ? Math.max(1, profile.dailyStreak || 1) : 1,
        lastStudyDate: key,
        knownFamilyIds: [...known],
        coverageEstimate: coverage.coverage,
        vocabSizeEstimate: coverage.known,
        cefrEstimate: coverage.cefr,
        reviewDebt: Math.max(0, dueCount - 1),
      };
      await profileRepo.save(userId, nextProfile);

      setStates((prev) => [...prev.filter((s) => s.cardId !== card.id), next]);
      setLogs((prev) => [
        ...prev,
        { cardId: card.id, reviewedAt: Date.now(), grade: value, direction: card.direction },
      ]);
      setProfile(nextProfile);
    },
    [userId, stateMap, profile, known, coverage, dueCount],
  );

  /** 全局部分写 localStorage，学习参数写该用户的库 */
  const saveSettings = useCallback(
    async (next: Settings) => {
      const globalPart: GlobalSettings = { llm: next.llm, decision: next.decision };
      setGlobalSettings(globalPart);
      setLearning(next.learning);
      settingsRepo.save(globalPart);
      if (userId) await learningRepo.save(userId, next.learning);
    },
    [userId],
  );

  const switchUser = useCallback((id: string) => {
    setActiveUserId(id);
    setReady(false);
    setUserId(id);
  }, []);

  const addUser = useCallback((name: string) => {
    const { users: list, id } = createUser(name);
    setUsers(list);
    setActiveUserId(id);
    setReady(false);
    setUserId(id);
  }, []);

  const renameAccount = useCallback((id: string, name: string) => {
    setUsers(renameUser(id, name));
  }, []);

  const removeAccount = useCallback(async (id: string) => {
    await deleteUserDb(id);
    const list = removeUserRecord(id);
    const fallback = list[0];
    if (!fallback) {
      const { users: fresh, activeId } = ensureUsers();
      setUsers(fresh);
      setActiveUserId(activeId);
      setReady(false);
      setUserId(activeId);
      return;
    }
    setUsers(list);
    setActiveUserId(fallback.id);
    setReady(false);
    setUserId(fallback.id);
  }, []);

  /** 只清空该用户的学习状态，共享词库不受影响 */
  const resetCurrentUser = useCallback(async () => {
    if (!userId) return;
    const database = await getDb(userId);
    for (const store of USER_STORES) {
      await database.clear(store);
    }
    await profileRepo.save(userId, DEFAULT_PROFILE);
    await learningRepo.save(userId, DEFAULT_LEARNING);
    setProfile(DEFAULT_PROFILE);
    setLearning(DEFAULT_LEARNING);
    setReady(false);
    await load();
  }, [userId, load]);

  return {
    ready,
    loadError,
    users,
    userId,
    families,
    words,
    wordMap,
    sentenceMap,
    passages,
    cards,
    states,
    stateMap,
    nodes,
    logs,
    settings,
    profile,
    known,
    coverage,
    runtime,
    dueCount,
    learnedToday,
    session,
    grade,
    saveSettings,
    switchUser,
    addUser,
    renameAccount,
    removeAccount,
    resetCurrentUser,
    reload: load,
  };
}
