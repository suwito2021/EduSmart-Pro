export type QuestionType = 'PG' | 'PGK' | 'BS' | 'MENJODOHKAN' | 'URAIAN';

export interface QuestionRecord {
  id: string;
  type: QuestionType;
  prompt: string;
  options: any;
  answerKey: any;
  points: number;
  explanation?: string;
}

export interface SessionRecord {
  id: string;
  studentId: string;
  studentName: string;
  answers: Record<string, any>;
  essayGrades: Record<string, { score: number; note?: string }>;
  totalScore: number;
}

export interface DistractorStat {
  optionKey: string;
  label: string;
  isCorrect: boolean;
  totalCount: number;
  totalPct: number;
  upperCount: number;
  lowerCount: number;
  effectiveness: 'Efektif' | 'Kurang Efektif' | 'Tidak Dipilih' | 'Kunci Jawaban';
}

export interface ItemAnalysisResult {
  questionId: string;
  number: number;
  type: QuestionType;
  promptPreview: string;
  maxPoints: number;
  respondentCount: number;
  meanScore: number;
  difficultyIndex: number;
  difficultyCategory: 'Sukar' | 'Sedang' | 'Mudah';
  discriminationIndex: number;
  discriminationCategory: 'Baik Sekali' | 'Baik' | 'Cukup' | 'Jelek';
  validityRxy: number;
  validityStatus: 'Valid' | 'Tidak Valid';
  recommendation: 'Diterima' | 'Revisi' | 'Dibuang';
  recommendationReason: string;
  distractors: DistractorStat[];
  answerDistribution: Array<{ label: string; count: number; pct: number }>;
}

export interface ExamAnalysisReport {
  examId: string;
  examTitle: string;
  subject: string;
  respondentCount: number;
  questionCount: number;
  reliabilityAlpha: number;
  reliabilityCategory: 'Sangat Tinggi' | 'Tinggi' | 'Cukup' | 'Rendah';
  meanTotalScore: number;
  stdDevTotalScore: number;
  highestScore: number;
  lowestScore: number;
  items: ItemAnalysisResult[];
}

export function gradeQuestionItem(
  q: QuestionRecord,
  studentAnswer: any,
  essayGrade?: { score: number; note?: string }
): number {
  const maxPts = Number(q.points) || 10;
  if (studentAnswer === undefined || studentAnswer === null || studentAnswer === '') {
    if (q.type === 'URAIAN' && essayGrade && typeof essayGrade.score === 'number') {
      return Math.max(0, Math.min(maxPts, essayGrade.score));
    }
    return 0;
  }

  if (q.type === 'PG') {
    return String(studentAnswer) === String(q.answerKey) ? maxPts : 0;
  }

  if (q.type === 'PGK') {
    const correctSet = new Set((Array.isArray(q.answerKey) ? q.answerKey : []).map(String));
    const chosenSet = new Set((Array.isArray(studentAnswer) ? studentAnswer : []).map(String));
    if (correctSet.size === 0) return 0;
    let hits = 0;
    let wrong = 0;
    chosenSet.forEach((c) => {
      if (correctSet.has(c)) hits += 1;
      else wrong += 1;
    });
    const ratio = Math.max(0, (hits - wrong * 0.5) / correctSet.size);
    return Number((ratio * maxPts).toFixed(2));
  }

  if (q.type === 'BS') {
    // Supports either single boolean/string OR array of statement answers
    if (Array.isArray(q.answerKey)) {
      const chosen = Array.isArray(studentAnswer) ? studentAnswer : [];
      let correctCount = 0;
      q.answerKey.forEach((ans: any, idx: number) => {
        if (String(chosen[idx]) === String(ans)) correctCount += 1;
      });
      return Number(((correctCount / Math.max(1, q.answerKey.length)) * maxPts).toFixed(2));
    }
    return String(studentAnswer) === String(q.answerKey) ? maxPts : 0;
  }

  if (q.type === 'MENJODOHKAN') {
    const expectedMap = (q.answerKey && typeof q.answerKey === 'object') ? q.answerKey : {};
    const keys = Object.keys(expectedMap);
    if (keys.length === 0) return 0;
    const givenMap = (studentAnswer && typeof studentAnswer === 'object') ? studentAnswer : {};
    let matched = 0;
    for (const k of keys) {
      if (String(givenMap[k] ?? '') === String(expectedMap[k])) {
        matched += 1;
      }
    }
    return Number(((matched / keys.length) * maxPts).toFixed(2));
  }

  if (q.type === 'URAIAN') {
    if (essayGrade && typeof essayGrade.score === 'number') {
      return Math.max(0, Math.min(maxPts, essayGrade.score));
    }
    // Partial keyword baseline until teacher manually reviews
    const keywords: string[] = Array.isArray(q.answerKey?.keywords) ? q.answerKey.keywords : [];
    if (keywords.length > 0 && typeof studentAnswer === 'string') {
      const lower = studentAnswer.toLowerCase();
      const hits = keywords.filter((kw) => lower.includes(String(kw).toLowerCase())).length;
      return Number(((hits / keywords.length) * maxPts * 0.6).toFixed(2));
    }
    return 0;
  }

  return 0;
}

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return 0;
  return Number((num / den).toFixed(3));
}

function variance(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length;
}

export function analyzeExamItems(
  examId: string,
  examTitle: string,
  subject: string,
  questions: QuestionRecord[],
  sessions: SessionRecord[]
): ExamAnalysisReport {
  const n = sessions.length;
  if (n === 0 || questions.length === 0) {
    return {
      examId,
      examTitle,
      subject,
      respondentCount: n,
      questionCount: questions.length,
      reliabilityAlpha: 0,
      reliabilityCategory: 'Rendah',
      meanTotalScore: 0,
      stdDevTotalScore: 0,
      highestScore: 0,
      lowestScore: 0,
      items: [],
    };
  }

  // Recompute per-item scores and total score per student
  const studentTotals = sessions.map((s) => {
    let rawTotal = 0;
    const itemScores: Record<string, number> = {};
    for (const q of questions) {
      const sc = gradeQuestionItem(q, s.answers?.[q.id], s.essayGrades?.[q.id]);
      itemScores[q.id] = sc;
      rawTotal += sc;
    }
    return { session: s, rawTotal, itemScores };
  });

  // Sort descending by total score for upper/lower 27% groups
  const sorted = [...studentTotals].sort((a, b) => b.rawTotal - a.rawTotal);
  const groupSize = Math.max(1, Math.round(n * 0.27));
  const upperSet = new Set(sorted.slice(0, groupSize).map((x) => x.session.id));
  const lowerSet = new Set(sorted.slice(Math.max(0, n - groupSize)).map((x) => x.session.id));

  const totalsArr = studentTotals.map((x) => x.rawTotal);
  const totalVar = variance(totalsArr);
  let sumItemVar = 0;

  const items: ItemAnalysisResult[] = questions.map((q, idx) => {
    const maxPts = Math.max(1, Number(q.points) || 10);
    const scores = studentTotals.map((x) => x.itemScores[q.id]);
    sumItemVar += variance(scores);

    const meanScore = scores.reduce((a, b) => a + b, 0) / n;
    const P = Number((meanScore / maxPts).toFixed(3));
    const difficultyCategory: ItemAnalysisResult['difficultyCategory'] =
      P < 0.3 ? 'Sukar' : P <= 0.7 ? 'Sedang' : 'Mudah';

    const upperScores = studentTotals
      .filter((x) => upperSet.has(x.session.id))
      .map((x) => x.itemScores[q.id] / maxPts);
    const lowerScores = studentTotals
      .filter((x) => lowerSet.has(x.session.id))
      .map((x) => x.itemScores[q.id] / maxPts);
    const upperMean = upperScores.reduce((a, b) => a + b, 0) / Math.max(1, upperScores.length);
    const lowerMean = lowerScores.reduce((a, b) => a + b, 0) / Math.max(1, lowerScores.length);
    const D = Number((upperMean - lowerMean).toFixed(3));
    const discriminationCategory: ItemAnalysisResult['discriminationCategory'] =
      D >= 0.4 ? 'Baik Sekali' : D >= 0.3 ? 'Baik' : D >= 0.2 ? 'Cukup' : 'Jelek';

    const rxy = pearsonCorrelation(scores, totalsArr);
    const rCritical = n >= 20 ? 0.36 : 0.44;
    const validityStatus: ItemAnalysisResult['validityStatus'] = rxy >= rCritical ? 'Valid' : 'Tidak Valid';

    let recommendation: ItemAnalysisResult['recommendation'] = 'Diterima';
    let recommendationReason = 'Tingkat kesukaran seimbang, daya pembeda dan validitas memadai.';
    if (D < 0.1 || rxy < 0.15) {
      recommendation = 'Dibuang';
      recommendationReason = 'Daya pembeda sangat rendah atau korelasi negatif/tidak valid.';
    } else if (D < 0.25 || P < 0.15 || P > 0.9 || validityStatus === 'Tidak Valid') {
      recommendation = 'Revisi';
      recommendationReason =
        P > 0.9
          ? 'Soal terlalu mudah; perbaiki pengecoh.'
          : P < 0.15
          ? 'Soal terlalu sukar; sederhanakan redaksi atau bobot.'
          : 'Daya pembeda/validitas perlu ditingkatkan melalui revisi opsi.';
    }

    // Distractor analysis & answer distribution for all 5 types
    const distractors: DistractorStat[] = [];
    const answerDistribution: Array<{ label: string; count: number; pct: number }> = [];

    if (q.type === 'PG' || q.type === 'PGK') {
      const opts: Array<{ key: string; text: string }> = Array.isArray(q.options) ? q.options : [];
      const correctKeys = new Set(
        q.type === 'PG'
          ? [String(q.answerKey)]
          : (Array.isArray(q.answerKey) ? q.answerKey : []).map(String)
      );
      opts.forEach((opt) => {
        let totalCount = 0;
        let upperCount = 0;
        let lowerCount = 0;
        for (const st of studentTotals) {
          const ans = st.session.answers?.[q.id];
          const chosen =
            q.type === 'PG'
              ? String(ans ?? '') === opt.key
              : Array.isArray(ans) && ans.map(String).includes(opt.key);
          if (chosen) {
            totalCount++;
            if (upperSet.has(st.session.id)) upperCount++;
            if (lowerSet.has(st.session.id)) lowerCount++;
          }
        }
        const totalPct = Number(((totalCount / n) * 100).toFixed(1));
        const isCorrect = correctKeys.has(opt.key);
        let effectiveness: DistractorStat['effectiveness'] = 'Efektif';
        if (isCorrect) {
          effectiveness = 'Kunci Jawaban';
        } else if (totalCount === 0) {
          effectiveness = 'Tidak Dipilih';
        } else if (totalPct < 5 || upperCount > lowerCount) {
          effectiveness = 'Kurang Efektif';
        }
        distractors.push({
          optionKey: opt.key,
          label: `${opt.key}. ${opt.text}`,
          isCorrect,
          totalCount,
          totalPct,
          upperCount,
          lowerCount,
          effectiveness,
        });
        answerDistribution.push({ label: `Opsi ${opt.key}`, count: totalCount, pct: totalPct });
      });
    } else if (q.type === 'BS') {
      const statements: string[] = Array.isArray(q.options?.statements)
        ? q.options.statements
        : ['Pernyataan'];
      const keys: string[] = Array.isArray(q.answerKey) ? q.answerKey.map(String) : [String(q.answerKey)];
      statements.forEach((stmt, sIdx) => {
        let benarCount = 0;
        let salahCount = 0;
        for (const st of studentTotals) {
          const ans = st.session.answers?.[q.id];
          const val = Array.isArray(ans) ? String(ans[sIdx] ?? '') : String(ans ?? '');
          if (val === 'Benar') benarCount++;
          else if (val === 'Salah') salahCount++;
        }
        const keyStr = keys[sIdx] || 'Benar';
        const benarPct = Number(((benarCount / n) * 100).toFixed(1));
        const salahPct = Number(((salahCount / n) * 100).toFixed(1));
        distractors.push({
          optionKey: `P${sIdx + 1}-B`,
          label: `P${sIdx + 1} (${stmt.slice(0, 32)}): Benar`,
          isCorrect: keyStr === 'Benar',
          totalCount: benarCount,
          totalPct: benarPct,
          upperCount: 0,
          lowerCount: 0,
          effectiveness: keyStr === 'Benar' ? 'Kunci Jawaban' : benarCount > 0 ? 'Efektif' : 'Tidak Dipilih',
        });
        distractors.push({
          optionKey: `P${sIdx + 1}-S`,
          label: `P${sIdx + 1} (${stmt.slice(0, 32)}): Salah`,
          isCorrect: keyStr === 'Salah',
          totalCount: salahCount,
          totalPct: salahPct,
          upperCount: 0,
          lowerCount: 0,
          effectiveness: keyStr === 'Salah' ? 'Kunci Jawaban' : salahCount > 0 ? 'Efektif' : 'Tidak Dipilih',
        });
        answerDistribution.push({ label: `P${sIdx + 1} Benar`, count: benarCount, pct: benarPct });
        answerDistribution.push({ label: `P${sIdx + 1} Salah`, count: salahCount, pct: salahPct });
      });
    } else if (q.type === 'MENJODOHKAN') {
      const expectedMap = (q.answerKey && typeof q.answerKey === 'object') ? q.answerKey : {};
      const keys = Object.keys(expectedMap);
      keys.forEach((leftKey, pIdx) => {
        let exactMatch = 0;
        let upperMatch = 0;
        let lowerMatch = 0;
        for (const st of studentTotals) {
          const given = st.session.answers?.[q.id];
          if (given && String(given[leftKey] ?? '') === String(expectedMap[leftKey])) {
            exactMatch++;
            if (upperSet.has(st.session.id)) upperMatch++;
            if (lowerSet.has(st.session.id)) lowerMatch++;
          }
        }
        const pct = Number(((exactMatch / n) * 100).toFixed(1));
        distractors.push({
          optionKey: `Pas-${pIdx + 1}`,
          label: `${leftKey} → ${expectedMap[leftKey]}`,
          isCorrect: true,
          totalCount: exactMatch,
          totalPct: pct,
          upperCount: upperMatch,
          lowerCount: lowerMatch,
          effectiveness: exactMatch > 0 ? 'Efektif' : 'Tidak Dipilih',
        });
        answerDistribution.push({ label: `Pasangan ${pIdx + 1} Benar`, count: exactMatch, pct });
      });
    } else {
      // URAIAN score distribution buckets
      const buckets = [
        { label: '0–25% (Rendah)', min: 0, max: 0.25, count: 0 },
        { label: '26–50% (Cukup)', min: 0.2501, max: 0.5, count: 0 },
        { label: '51–75% (Baik)', min: 0.5001, max: 0.75, count: 0 },
        { label: '76–100% (Sangat Baik)', min: 0.7501, max: 1.01, count: 0 },
      ];
      for (const sc of scores) {
        const ratio = sc / maxPts;
        const b = buckets.find((x) => ratio >= x.min && ratio <= x.max) || buckets[0];
        b.count++;
      }
      buckets.forEach((b) => {
        const pct = Number(((b.count / n) * 100).toFixed(1));
        answerDistribution.push({ label: b.label, count: b.count, pct });
      });
    }

    return {
      questionId: q.id,
      number: idx + 1,
      type: q.type,
      promptPreview: q.prompt.replace(/<[^>]+>/g, '').slice(0, 90),
      maxPoints: maxPts,
      respondentCount: n,
      meanScore: Number(meanScore.toFixed(2)),
      difficultyIndex: P,
      difficultyCategory,
      discriminationIndex: D,
      discriminationCategory,
      validityRxy: rxy,
      validityStatus,
      recommendation,
      recommendationReason,
      distractors,
      answerDistribution,
    };
  });

  const k = questions.length;
  let alpha = 0;
  if (k > 1 && totalVar > 0) {
    alpha = (k / (k - 1)) * (1 - sumItemVar / totalVar);
  }
  alpha = Number(Math.max(0, Math.min(1, alpha)).toFixed(3));
  const reliabilityCategory: ExamAnalysisReport['reliabilityCategory'] =
    alpha >= 0.8 ? 'Sangat Tinggi' : alpha >= 0.65 ? 'Tinggi' : alpha >= 0.5 ? 'Cukup' : 'Rendah';

  const meanTotal = totalsArr.reduce((a, b) => a + b, 0) / n;
  const maxPossible = questions.reduce((s, q) => s + (Number(q.points) || 10), 0);
  const scale100 = (v: number) => Number(((v / Math.max(1, maxPossible)) * 100).toFixed(2));

  return {
    examId,
    examTitle,
    subject,
    respondentCount: n,
    questionCount: k,
    reliabilityAlpha: alpha,
    reliabilityCategory,
    meanTotalScore: scale100(meanTotal),
    stdDevTotalScore: scale100(Math.sqrt(totalVar)),
    highestScore: scale100(Math.max(...totalsArr)),
    lowestScore: scale100(Math.min(...totalsArr)),
    items,
  };
}
