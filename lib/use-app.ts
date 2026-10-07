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
import { setDecisionFallbackLlm } from './llm/decision';
import { setLlmUser } from './llm/telemetry';
import {
  buildSession,
  configureScheduler,
  createInitialState,
  isMorphemeCard,
  retentionOf,
  schedule,
} from './srs';
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
  const cardMap = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const known = useMemo(() => computeKnownFamilies(families, cards, stateMap), [families, cards, stateMap]);
  const coverage = useMemo(() => estimateCoverage(families, known), [families, known]);
  const runtime = useMemo(() => computeRuntime(nodes, cards, stateMap), [nodes, cards, stateMap]);

  const dueCount = useMemo(() => {
    const now = Date.now();
    return states.filter((s) => s.reps > 0 && s.dueAt <= now).length;
  }, [states]);

  /**
   * 把设置页的「目标保持率」注入排程。
   * 此前 `learning.retentionTarget` 是**摆设**：设置页有滑块、类型与默认值都有，
   * 但排程代码从未读过它。现在它直接决定 FSRS 的 `request_retention`。
   */
  useEffect(() => {
    configureScheduler(learning.retentionTarget);
  }, [learning.retentionTarget]);

  /**
   * 决策模型复用同一份大模型配置：用户只需要配一个 LLM。
   * 没有单独的百炼凭据时，学习负担评分与例句质量校验都会走这个模型（JSON 约束输出）。
   */
  useEffect(() => {
    setDecisionFallbackLlm(globalSettings.llm);
    return () => setDecisionFallbackLlm(undefined);
  }, [globalSettings.llm]);

  /** 我的真实保持率：最近 100 次复习的答对比例（零参数的"个体基准"指标） */
  const retention = useMemo(() => retentionOf(logs), [logs]);

  /**
   * 今日"已学新卡"统计：先取每张卡今日最早的一条记录，再分别按词族 / 词根去重。
   *
   * 旧实现是「今日日志条数 / 2」，隐含"每词恰好 2 张卡、各答一次"的假设。
   * 启用分钟级学习步骤后，一张新卡在同一会话里可能产生 3 条记录（1m 重现 / 10m 重现 / 毕业），
   * 该假设失效会让新词额度被提前吃光。改为按**首次接触的唯一词族数**计量，
   * 与"今天学了几个词"的语义对齐；词根卡同理且独立计量（D11）。
   */
  const learnedStats = useMemo(() => {
    const key = todayKey();
    const firstSeen = new Map<string, number>();
    for (const l of logs) {
      if (todayKey(new Date(l.reviewedAt)) !== key) continue;
      const prev = firstSeen.get(l.cardId);
      if (prev === undefined || l.reviewedAt < prev) firstSeen.set(l.cardId, l.reviewedAt);
    }
    const families = new Set<string>();
    let morph = 0;
    for (const cardId of firstSeen.keys()) {
      const card = cardMap.get(cardId);
      if (!card) continue;
      if (isMorphemeCard(card)) morph += 1;
      else if (card.familyId) families.add(card.familyId);
    }
    return { families: families.size, morph };
  }, [logs, cardMap]);

  /** 今日新学词族数（对外语义不变：界面上仍是一个数字） */
  const learnedToday = learnedStats.families;

  const session = useMemo(
    () =>
      buildSession({
        cards,
        states: stateMap,
        newLimit: learning.dailyNewLimit,
        learnedToday: learnedStats.families,
        morphLearnedToday: learnedStats.morph,
      }),
    [cards, stateMap, learning.dailyNewLimit, learnedStats],
  );

  const grade = useCallback(
    async (card: Card, value: number) => {
      if (!userId) return;
      const current = stateMap.get(card.id) ?? createInitialState(card);
      const next = schedule(current, value);
      const reviewedAt = Date.now();
      await reviewRepo.put(userId, next);
      await reviewRepo.log(userId, {
        cardId: card.id,
        reviewedAt,
        grade: value,
        direction: card.direction,
        // FSRS 参数优化的必需特征，且无法事后回填：现在不记，将来拿不到
        elapsedDays: current.elapsedDays,
        stateBefore: current.fsrsState,
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
        {
          cardId: card.id,
          reviewedAt,
          grade: value,
          direction: card.direction,
          elapsedDays: current.elapsedDays,
          stateBefore: current.fsrsState,
        },
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
    retention,
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
