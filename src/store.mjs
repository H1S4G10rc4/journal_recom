import {
  randomBytes,
  scryptSync,
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  chmodSync,
} from "node:fs";
import path from "node:path";
export function atomicJSON(file, data) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + randomBytes(6).toString("hex") + ".tmp";
  writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
  renameSync(temp, file);
}
export class Vault {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {}
    this.configFile = path.join(dir, "settings.json");
    this.file = path.join(dir, "library.enc");
    this.config = existsSync(this.configFile)
      ? JSON.parse(readFileSync(this.configFile, "utf8"))
      : null;
    this.data = null;
    this.key = null;
  }
  get initialized() {
    return Boolean(this.config);
  }
  get unlocked() {
    return Boolean(this.key && this.data);
  }
  derive(password, salt) {
    if (typeof password !== "string" || password.length > 1024)
      throw Error("パスワードを確認してください。");
    return scryptSync(password, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
  }
  verifier(key) {
    return createHmac("sha256", key)
      .update("paper-desk-local-vault-v1")
      .digest();
  }
  initialize(password) {
    if (this.initialized) throw Error("初回設定は完了しています。");
    if (typeof password !== "string" || password.length < 8)
      throw Error("パスワードは8文字以上で設定してください。");
    const salt = randomBytes(16);
    this.key = this.derive(password, salt);
    this.config = {
      version: 1,
      salt: salt.toString("hex"),
      verifier: this.verifier(this.key).toString("hex"),
    };
    this.data = {
      profile: null,
      draft: { answers: {}, step: 0 },
      papers: [],
      runs: [],
      schedule: {
        time: "06:00",
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo",
        enabled: true,
      },
      createdAt: new Date().toISOString(),
    };
    this.save();
    atomicJSON(this.configFile, this.config);
  }
  unlock(password) {
    if (!this.initialized) throw Error("初回設定が必要です。");
    const key = this.derive(password, Buffer.from(this.config.salt, "hex"));
    const expected = Buffer.from(this.config.verifier, "hex");
    if (!timingSafeEqual(this.verifier(key), expected)) {
      key.fill(0);
      throw Error("パスワードが違います。");
    }
    const envelope = JSON.parse(readFileSync(this.file, "utf8"));
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "hex"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]);
    this.data = JSON.parse(plain.toString("utf8"));
    plain.fill(0);
    this.key = key;
  }
  save() {
    if (!this.unlocked) throw Error("ロックを解除してください。");
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(this.data), "utf8"),
      cipher.final(),
    ]);
    atomicJSON(this.file, {
      version: 1,
      iv: iv.toString("hex"),
      tag: cipher.getAuthTag().toString("hex"),
      data: data.toString("base64"),
    });
  }
  change(fn) {
    if (!this.unlocked) throw Error("ロックを解除してください。");
    const before = structuredClone(this.data);
    try {
      const result = fn(this.data);
      this.save();
      return result;
    } catch (e) {
      this.data = before;
      throw e;
    }
  }
  close() {
    this.key?.fill(0);
    this.key = null;
    this.data = null;
  }
}
export function canonicalId(value) {
  if (typeof value !== "string") throw Error("arXiv IDが不正です。");
  const match = value
    .trim()
    .match(
      /^(?:https:\/\/arxiv\.org\/(?:abs|html|pdf)\/)?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?(?:\.pdf)?$/,
    );
  if (!match) throw Error("arXiv IDが不正です。");
  return match[1];
}
export function dateInZone(now, zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const v = (k) => parts.find((p) => p.type === k).value;
  return `${v("year")}-${v("month")}-${v("day")}`;
}
export function isDue(data, now = new Date()) {
  if (!data?.profile || !data.schedule.enabled) return false;
  const { timezone, time } = data.schedule;
  const day = dateInZone(now, timezone);
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  if (clock < time) return false;
  const themes = data.profile.themes;
  return themes.some(
    (t) => !data.papers.some((p) => p.date === day && p.theme === t.id),
  );
}
export function validateSchedule(input) {
  if (!input || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time))
    throw Error("更新時刻を確認してください。");
  try {
    new Intl.DateTimeFormat("ja-JP", { timeZone: input.timezone });
  } catch {
    throw Error("タイムゾーンを確認してください。");
  }
  return {
    time: input.time,
    timezone: input.timezone,
    enabled: input.enabled !== false,
  };
}
export const QUESTIONS = [
  {
    id: "purpose",
    title: "何を明らかにしたいですか？",
    hint: "所属・立場と、研究でいちばん知りたいことを、普段の言葉で教えてください。",
    placeholder:
      "神経科学の修士1年です。神経回路が記憶を保存・検索するしくみを知りたいです。",
  },
  {
    id: "themeA",
    title: "1つ目の研究テーマを教えてください。",
    hint: "対象、現時点の仮説、最近困っていることまで、分かる範囲で大丈夫です。",
    placeholder:
      "成人海馬神経新生が記憶に与える影響を計算モデルで調べています。…",
  },
  {
    id: "themeB",
    title: "もう1つ、追いかけたいテーマはありますか？",
    hint: "主研究でも、役に立ちそうな手法でも構いません。毎日この2テーマから1本ずつ選びます。",
    placeholder: "全脳蛍光画像の細胞検出と、複数人の点アノテーションの統合。…",
  },
  {
    id: "methods",
    title: "どんなデータや手法を使っていますか？",
    hint: "モデル・実験・解析の方法と、次に比較／検証したいことを教えてください。",
    placeholder:
      "ANNモデルと蛍光画像を扱っています。単なる時間変動と神経新生の効果を分けたいです。…",
  },
  {
    id: "scope",
    title: "読みたい分野と、避けたい論文は？",
    hint: "関連分野、優先する新しさ、信頼性を判断するときに気にする点も自由にどうぞ。",
    placeholder:
      "計算原理や検証可能な予測を重視。ベンチマークの数値改善だけの論文は優先しません。…",
  },
  {
    id: "known",
    title: "すでに読んだ論文や、気になる先行研究は？",
    hint: "題名・arXiv URL・著者名で構いません。「読了」と「名前を知っている」を分けて書くと、重複を避けやすくなります。空欄でも進めます。",
    optional: true,
    placeholder: "読了：…\n参照したことがあるが未読：…\nもっと知りたい：…",
  },
  {
    id: "style",
    title: "どんな紹介なら、読み進められそうですか？",
    hint: "言語、説明の深さ、数式、図、1本の長さなど。空欄なら、日本語で背景・手法・結果・研究への関連を詳しく紹介します。",
    optional: true,
    placeholder:
      "日本語の常体。主要な数式の変数も説明してほしいです。原図と、自分の研究で試せる比較実験も知りたい。",
  },
];
export function buildProfile(answers) {
  for (const q of QUESTIONS) {
    if (!q.optional && (!answers[q.id]?.trim() || answers[q.id].length > 12000))
      throw Error(q.title + "への回答を入力してください。");
  }
  return {
    version: 1,
    answers: Object.fromEntries(
      QUESTIONS.map((q) => [
        q.id,
        String(answers[q.id] || "")
          .trim()
          .slice(0, 12000),
      ]),
    ),
    themes: [
      { id: "A", name: "テーマ1", focus: answers.themeA.trim() },
      { id: "B", name: "テーマ2", focus: answers.themeB.trim() },
    ],
    dailyCount: 2,
  };
}
