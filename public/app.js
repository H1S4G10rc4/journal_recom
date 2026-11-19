const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function url(s) {
  try {
    const u = new URL(s, location.origin);
    return ["https:", "http:"].includes(u.protocol) ? esc(u.href) : "#";
  } catch {
    return "#";
  }
}
function rich(value) {
  let s = String(value || ""),
    out = "",
    last = 0;
  for (const m of s.matchAll(/\[([^\]\n]{1,120})\]\((https:\/\/[^\s)]+)\)/g)) {
    out +=
      esc(s.slice(last, m.index)) +
      `<a href="${url(m[2])}" target="_blank" rel="noopener">${esc(m[1])} ↗</a>`;
    last = m.index + m[0].length;
  }
  return out + esc(s.slice(last));
}
let state,
  mode = "",
  step = 0,
  answers = {},
  schedule,
  allPapers = [],
  filter = "all",
  theme = "all",
  query = "",
  selectedDate = "all",
  poller,
  openCards = new Set(),
  memoDrafts = new Map(),
  memoQueues = new Map(),
  memoTimers = new Map(),
  toastTimer;
const name = '<span class="wordmark">PaperCue</span>';
async function api(path, options = {}) {
  const r = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const d = await r.json();
  if (!r.ok) {
    if (r.status === 401 && mode === "library") {
      mode = "";
      refresh();
    }
    throw Error(d.error || "処理できませんでした。");
  }
  return d;
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 4500);
}
function noteError(e) {
  toast(e.message || String(e));
}
function shell(contents, progress = "") {
  return `<main class="setup"><header>${name}</header><div class="setup-layout"><aside><ol class="steps"><li class="${progress === "connect" ? "current" : ""}">ChatGPTを接続</li><li class="${progress === "password" ? "current" : ""}">デスクの鍵を設定</li><li class="${progress === "questions" ? "current" : ""}">研究について教える</li><li class="${progress === "review" ? "current" : ""}">方針を確認して始める</li></ol><small>研究内容、既読、メモはこのPCに保存します。<br>推薦を調べる際は、回答内容とメモをChatGPTへ送ります。</small></aside><section class="setup-card">${contents}</section></div></main>`;
}
function connectScreen() {
  mode = "connect";
  $("#root").innerHTML = shell(
    `<div class="step-number">STEP 01 / 04</div><h2>ChatGPTにログイン</h2><div class="connection ${state.account.signedIn ? "connected" : ""}"><span class="connection-symbol">◉</span><div><b>${state.account.signedIn ? "ChatGPTに接続しました" : "ChatGPTアカウント"}</b><small>${state.account.signedIn ? "このアカウントの利用枠で論文を調べます。" : "ログインはChatGPTの公式サイトで行います。"}</small></div></div><p class="helper">対応するChatGPTプランの利用枠を使います。接続情報はこのPCで管理し、アプリ提供者には送りません。</p><div class="form-error" role="alert">${esc(state.account.error || "")}</div>${state.account.signedIn ? '<button class="primary" id="continue">次へ進む →</button>' : '<button class="primary" id="connect">ChatGPTでログイン ↗</button><p class="waiting" id="auth-wait" ' + (state.account.pending ? "" : "hidden") + ">公式サイトでログインしたら、この画面に戻ってください。</p>"}<button class="text-button" id="skip">研究の設定を先に進める</button>`,
    "connect",
  );
  $("#continue")?.addEventListener("click", passwordScreen);
  $("#connect")?.addEventListener("click", startAuth);
  $("#skip").onclick = passwordScreen;
}
async function startAuth() {
  const button = $("#connect") || $("#reconnect");
  if (button) button.disabled = true;
  try {
    const d = await api("/api/auth/start", { method: "POST" });
    window.open(d.url, "_blank", "noopener");
    $("#auth-wait")?.removeAttribute("hidden");
    toast("公式サイトで認証を済ませて、このアプリに戻ってください。");
  } catch (e) {
    noteError(e);
  } finally {
    if (button) button.disabled = false;
  }
}
function passwordScreen() {
  mode = "password";
  $("#root").innerHTML = shell(
    `<div class="step-number">STEP 02 / 04</div><h2>パスワード設定</h2><form id="password-form"><label for="password">パスワード（8文字以上）</label><input id="password" type="password" minlength="8" maxlength="1024" autocomplete="new-password" required><label for="confirm">もう一度入力</label><input id="confirm" type="password" minlength="8" maxlength="1024" autocomplete="new-password" required><p class="helper">研究内容と読書記録は、このパスワードで暗号化して保存します。忘れると保存済みデータを復元できないため、大切に保管してください。</p><div class="form-error" role="alert"></div><button class="primary">設定して次へ →</button></form>`,
    "password",
  );
  $("#password-form").onsubmit = async (e) => {
    e.preventDefault();
    const p = $("#password").value;
    if (p !== $("#confirm").value) {
      $(".form-error").textContent = "パスワードが一致しません。";
      return;
    }
    const b = $("#password-form button");
    b.disabled = true;
    try {
      await api("/api/setup/password", {
        method: "POST",
        body: JSON.stringify({ password: p }),
      });
      state = await api("/api/state");
      answers = {};
      step = 0;
      questionScreen();
    } catch (e) {
      $(".form-error").textContent = e.message;
      b.disabled = false;
    }
  };
}
function unlockScreen() {
  mode = "unlock";
  $("#root").innerHTML =
    `<main class="unlock">${name}<h1>ロック解除</h1><form id="unlock-form"><label for="password">パスワード</label><input type="password" id="password" autocomplete="current-password" maxlength="1024" required autofocus><div class="form-error" role="alert"></div><button class="primary">デスクを開く →</button></form><p class="helper">PCの起動後は、最初にロックを解除すると自動更新を再開します。</p></main>`;
  $("#unlock-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = $("#unlock-form button");
    b.disabled = true;
    try {
      await api("/api/unlock", {
        method: "POST",
        body: JSON.stringify({ password: $("#password").value }),
      });
      mode = "";
      await refresh();
    } catch (e) {
      $(".form-error").textContent = e.message;
      b.disabled = false;
    }
  };
}
function questionScreen() {
  mode = "questions";
  const q = state.questions[step];
  if (!q) return reviewScreen();
  $("#root").innerHTML = shell(
    `<div class="question-progress"><span>QUESTION ${String(step + 1).padStart(2, "0")} / ${String(state.questions.length).padStart(2, "0")}</span><div><i style="width:${((step + 1) / state.questions.length) * 100}%"></i></div></div><h2>${esc(q.title)}</h2><p class="lead">${esc(q.hint)}</p><form id="answer-form"><label class="sr-only" for="answer">${esc(q.title)}</label><textarea id="answer" maxlength="12000" rows="7" placeholder="${esc(q.placeholder)}" ${q.optional ? "" : "required"}>${esc(answers[q.id] || "")}</textarea><div class="question-actions"><button class="secondary" id="back" type="button" ${step === 0 && !state.profile ? "hidden" : ""}>← 戻る</button><button class="primary">${step === state.questions.length - 1 ? "設定を確認する" : "次の質問へ"} →</button></div><div class="form-error" role="alert"></div></form>`,
    "questions",
  );
  $("#answer-form").onsubmit = async (e) => {
    e.preventDefault();
    await saveAnswer(1);
  };
  $("#back").onclick = () => saveAnswer(-1);
}
async function saveAnswer(delta) {
  const q = state.questions[step];
  answers[q.id] = $("#answer").value;
  try {
    await api("/api/setup/draft", {
      method: "POST",
      body: JSON.stringify({ answers, step: Math.max(0, step + delta) }),
    });
    if (step === 0 && delta < 0) {
      libraryScreen();
      return;
    }
    step += delta;
    questionScreen();
  } catch (e) {
    $(".form-error").textContent = e.message;
  }
}
function reviewScreen() {
  mode = "review";
  schedule = schedule ||
    state.schedule || {
      time: "06:00",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      enabled: true,
    };
  $("#root").innerHTML = shell(
    `<div class="step-number">STEP 04 / 04</div><h2>推薦設定の確認</h2><div class="review-themes"><section><span>THEME 01</span><p>${esc(answers.themeA || "未入力")}</p></section><section><span>THEME 02</span><p>${esc(answers.themeB || "未入力")}</p></section></div><details class="review-details"><summary>研究目的・手法・選定方針の回答をすべて見る</summary>${state.questions
      .filter((q) => !["themeA", "themeB"].includes(q.id))
      .map(
        (q) =>
          `<h4>${esc(q.title)}</h4><p>${esc(answers[q.id] || "指定なし")}</p>`,
      )
      .join(
        "",
      )}</details><form id="review-form"><div class="schedule-inputs"><div><label for="time">毎朝の更新時刻</label><input type="time" id="time" value="${esc(schedule.time)}" required></div><div><label for="timezone">タイムゾーン</label><input id="timezone" value="${esc(schedule.timezone)}" list="zones" required><datalist id="zones"><option>Asia/Tokyo</option><option>Europe/London</option><option>America/New_York</option><option>America/Los_Angeles</option><option>UTC</option></datalist></div></div><label class="check-label"><input type="checkbox" id="enabled" ${schedule.enabled ? "checked" : ""}>毎朝、自動で推薦を更新する</label><p class="helper">アプリはPC起動時に開きます。ロック解除後は、画面を閉じてもバックグラウンドで更新します。PCが休止中なら、復帰後にその日の分を補います。</p>${!state.account.signedIn ? '<p class="info">ChatGPTはまだ未接続です。設定を保存してから、デスクで接続できます。</p>' : ""}<div class="question-actions"><button class="secondary" id="edit" type="button">回答を見直す</button><button class="primary">この方針で始める →</button></div><div class="form-error" role="alert"></div></form>`,
    "review",
  );
  $("#edit").onclick = () => {
    step = 0;
    questionScreen();
  };
  $("#review-form").onsubmit = async (e) => {
    e.preventDefault();
    const b = $("#review-form .primary");
    b.disabled = true;
    schedule = {
      time: $("#time").value,
      timezone: $("#timezone").value,
      enabled: $("#enabled").checked,
    };
    try {
      await api("/api/profile", {
        method: "POST",
        body: JSON.stringify({ answers, schedule }),
      });
      mode = "";
      await refresh();
    } catch (e) {
      $(".form-error").textContent = e.message;
      b.disabled = false;
    }
  };
}
function typeset(el) {
  if (window.MathJax?.typesetPromise)
    MathJax.typesetPromise([el]).catch(() => {});
}
function dateLabel(d) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  });
}
function figure(f) {
  return `<figure><img data-figure src="${esc(f.local_url)}" alt="${esc(f.label + "：" + f.caption)}" loading="lazy"><figcaption><b>${esc(f.label)}</b> ${esc(f.caption)}<small><a href="${url(f.source_url)}" target="_blank" rel="noopener">原図・出典 ↗</a> · ${esc(f.license)}<br>${esc(f.processing)}</small></figcaption></figure>`;
}
function paperCard(p) {
  const sections = [
    ["background", "背景"],
    ["method", "手法・モデル"],
    ["results", "主な結果"],
    ["relation", "研究とのつながり"],
    ["recommend", "読みどころ"],
  ];
  return `<article class="paper" data-id="${esc(p.id)}"><div class="paper-inner"><div class="paper-meta"><span class="tag theme-${esc(p.theme)}">${p.theme === "A" ? "テーマ1" : "テーマ2"} · ${esc(p.kind)}</span><span>${esc(p.date)} / 0${p.order}</span></div><h3><a target="_blank" rel="noopener" href="${url(p.url)}">${esc(p.title)}</a></h3><p class="authors">${esc(p.authors)}</p><p class="bibliography">${esc(p.journal || p.venue || "掲載未確認（arXiv版）")} · v1: ${esc(p.v1_date || "未確認")}</p><p class="paper-summary">${rich(p.summary)}</p>${(p.figures || []).slice(0, 1).map(figure).join("")}<button class="text-button detail-toggle" data-action="detail" aria-expanded="${openCards.has(p.id)}">${openCards.has(p.id) ? "紹介文を閉じる −" : "背景・手法・結果を詳しく読む ＋"}</button><div class="paper-details" ${openCards.has(p.id) ? "" : "hidden"}>${sections.map(([key, title]) => `<section><h4>${title}</h4><p>${rich(p[key])}</p></section>`).join("")}${(p.figures || []).slice(1).map(figure).join("")}${p.note ? `<p class="paper-note">確認範囲・留意点<br>${rich(p.note)}</p>` : ""}</div></div><div class="paper-bottom"><div class="paper-actions"><button class="read-button ${p.read ? "read" : ""}" data-action="read" aria-pressed="${p.read}">${p.read ? "✓ 読了" : "○ 読んだらチェック"}</button><button class="text-button" data-action="memo">${p.memo ? "メモを編集" : "メモを書く"} ↗</button><a href="${url(p.url)}" target="_blank" rel="noopener">arXiv ↗</a></div><div class="memo" ${p.memo || memoDrafts.has(p.id) ? "" : "hidden"}><label for="memo-${esc(p.id)}">気になったこと、試したいこと。次の推薦にも反映します。</label><textarea id="memo-${esc(p.id)}" data-memo="${esc(p.id)}" maxlength="20000" rows="3">${esc(memoDrafts.get(p.id) ?? p.memo)}</textarea><div class="save-status">${p.memo ? "保存済み" : "入力後に自動保存"}</div></div></div></article>`;
}
function libraryScreen() {
  mode = "library";
  $("#root").innerHTML =
    `<div class="desk"><aside class="sidebar">${name}<div class="read-stats"><strong id="read-count">0</strong><span>本を読了</span><small id="total-count"></small></div><nav><button class="active" data-theme="all">◫ すべてのテーマ</button><button data-theme="A"><i class="dot theme-A"></i>テーマ1</button><button data-theme="B"><i class="dot theme-B"></i>テーマ2</button></nav><div class="archive-label">ARCHIVE</div><div id="dates"></div><div class="sidebar-bottom"><p id="schedule-label"></p><button class="text-button" id="settings">研究と推薦の設定</button><a href="/api/export" download>データを書き出す ↗</a><button class="text-button" id="lock">デスクをロック</button></div></aside><main class="library"><header><button class="text-button mobile-settings" id="mobile-settings">設定</button><span id="date"></span></header><section class="introduction"><div><h1>論文ライブラリ</h1></div></section><div class="account-banner" id="account-banner" ${state.account.signedIn ? "hidden" : ""}><div><b>ChatGPTを接続して、最初の2本を探しましょう。</b><p>研究の設定は保存されています。</p></div><button class="primary" id="reconnect">ChatGPTでログイン ↗</button></div><section class="library-toolbar"><div class="tabs"><button data-filter="all" class="active">すべて</button><button data-filter="unread">未読</button><button data-filter="read">読了</button></div><input type="search" id="search" placeholder="タイトル・内容・メモで検索" aria-label="論文を検索"></section><div class="list-heading"><h2>推薦ライブラリ</h2><span id="shown-count"></span></div><div id="papers"></div><section class="run-panel"><div><b id="run-title">次の論文を待っています</b><p id="run-time"></p></div><button class="text-button" id="generate">今日の推薦を更新 ↗</button></section><details class="run-details"><summary>選定・更新の記録</summary><pre id="run-report"></pre></details></main></div>`;
  $("#settings").onclick = editProfile;
  $("#mobile-settings").onclick = editProfile;
  $("#lock").onclick = lockDesk;
  $("#reconnect").onclick = startAuth;
  $("#generate").onclick = async () => {
    try {
      const r = await api("/api/generate", { method: "POST" });
      toast(
        r.alreadyComplete
          ? "今日の2本は準備済みです。"
          : "論文の検索を始めました。",
      );
      await updateStatus();
    } catch (e) {
      noteError(e);
    }
  };
  for (const b of $$("[data-theme]"))
    b.onclick = () => {
      theme = b.dataset.theme;
      $$("[data-theme]").forEach((x) => x.classList.toggle("active", x === b));
      renderPapers();
    };
  for (const b of $$("[data-filter]"))
    b.onclick = () => {
      filter = b.dataset.filter;
      $$("[data-filter]").forEach((x) => x.classList.toggle("active", x === b));
      renderPapers();
    };
  $("#search").oninput = (e) => {
    query = e.target.value.toLowerCase().trim();
    renderPapers();
  };
  $("#dates").onclick = (e) => {
    const b = e.target.closest("[data-date]");
    if (b) {
      selectedDate = b.dataset.date;
      renderPapers();
    }
  };
  $("#papers").onclick = paperClick;
  $("#papers").oninput = (e) => {
    const id = e.target.dataset.memo;
    if (!id) return;
    memoDrafts.set(id, e.target.value);
    e.target.nextElementSibling.textContent = "未保存";
    clearTimeout(memoTimers.get(id));
    memoTimers.set(
      id,
      setTimeout(() => saveMemo(id), 700),
    );
  };
  $("#papers").addEventListener("focusout", (e) => {
    const id = e.target.dataset.memo;
    if (id) {
      clearTimeout(memoTimers.get(id));
      saveMemo(id);
    }
  });
  loadPapers().then(updateStatus).catch(noteError);
}
function editProfile() {
  answers = { ...state.profile.answers };
  schedule = { ...state.schedule };
  step = 0;
  questionScreen();
}
async function lockDesk() {
  await Promise.all([...memoDrafts.keys()].map(saveMemo));
  if (memoDrafts.size)
    return toast("未保存のメモがあります。保存後にロックしてください。");
  await api("/api/lock", { method: "POST" });
  allPapers = [];
  state.profile = null;
  state.draft = null;
  answers = {};
  openCards.clear();
  mode = "";
  await refresh();
}
async function loadPapers() {
  const d = await api("/api/papers");
  allPapers = d.papers;
  $("#date").textContent = dateLabel(d.today);
  renderPapers();
}
function renderPapers() {
  if (mode !== "library") return;
  $("#read-count").textContent = allPapers.filter((p) => p.read).length;
  $("#total-count").textContent = allPapers.length + "本のライブラリ";
  const dates = [...new Set(allPapers.map((p) => p.date))];
  $("#dates").innerHTML =
    '<button data-date="all" class="' +
    (selectedDate === "all" ? "active" : "") +
    '">すべての日付</button>' +
    dates
      .map(
        (d) =>
          `<button data-date="${d}" class="${selectedDate === d ? "active" : ""}">${esc(dateLabel(d))}</button>`,
      )
      .join("");
  const list = allPapers.filter(
    (p) =>
      (theme === "all" || p.theme === theme) &&
      (selectedDate === "all" || p.date === selectedDate) &&
      (filter === "all" || (filter === "read" ? p.read : !p.read)) &&
      (!query ||
        [
          p.title,
          p.authors,
          p.summary,
          p.background,
          p.method,
          p.results,
          p.relation,
          p.memo,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query)),
  );
  $("#shown-count").textContent = list.length + " PAPERS";
  if (window.MathJax?.typesetClear) MathJax.typesetClear([$("#papers")]);
  $("#papers").innerHTML = list.length
    ? list.map(paperCard).join("")
    : `<div class="empty"><span>◫</span><h3>${allPapers.length ? "条件に合う論文はありません" : "最初の2本を、ここに。"}</h3><p>${allPapers.length ? "テーマや検索条件を変えてみてください。" : state.account.signedIn ? "本文と原図を確認して、あなたの研究に合う論文を届けます。<br>初回の準備には少し時間がかかります。" : "ChatGPTを接続すると、あなたの回答をもとに論文を探します。"}</p></div>`;
  typeset($("#papers"));
}
async function paperClick(e) {
  const image = e.target.closest("[data-figure]");
  if (image) {
    const d = $("#lightbox");
    d.querySelector("img").src = image.src;
    d.querySelector("img").alt = image.alt;
    d.querySelector("p").textContent = image
      .closest("figure")
      .querySelector("figcaption").textContent;
    d.showModal();
    return;
  }
  const button = e.target.closest("[data-action]");
  if (!button) return;
  const article = button.closest("article"),
    id = article.dataset.id,
    p = allPapers.find((p) => p.id === id);
  if (button.dataset.action === "detail") {
    openCards.has(id) ? openCards.delete(id) : openCards.add(id);
    const expanded = openCards.has(id);
    button.textContent = expanded
      ? "紹介文を閉じる −"
      : "背景・手法・結果を詳しく読む ＋";
    button.setAttribute("aria-expanded", expanded);
    article.querySelector(".paper-details").hidden = !expanded;
    typeset(article.querySelector(".paper-details"));
  }
  if (button.dataset.action === "memo") {
    const box = article.querySelector(".memo");
    box.hidden = !box.hidden;
    if (!box.hidden) box.querySelector("textarea").focus();
  }
  if (button.dataset.action === "read") {
    button.disabled = true;
    try {
      await api("/api/papers/" + id, {
        method: "PATCH",
        body: JSON.stringify({ read: !p.read }),
      });
      p.read = !p.read;
      button.classList.toggle("read", p.read);
      button.textContent = p.read ? "✓ 読了" : "○ 読んだらチェック";
      button.setAttribute("aria-pressed", p.read);
      $("#read-count").textContent = allPapers.filter((p) => p.read).length;
      if (filter !== "all") renderPapers();
    } catch (e) {
      noteError(e);
    }
    button.disabled = false;
  }
}
function saveMemo(id) {
  const previous = memoQueues.get(id) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      if (!memoDrafts.has(id)) return;
      const value = memoDrafts.get(id),
        element = document.querySelector(`[data-memo="${id}"]`);
      try {
        if (element) element.nextElementSibling.textContent = "保存中…";
        await api("/api/papers/" + id, {
          method: "PATCH",
          body: JSON.stringify({ memo: value }),
        });
        const p = allPapers.find((p) => p.id === id);
        if (p) p.memo = value;
        if (memoDrafts.get(id) === value) memoDrafts.delete(id);
        if (element) element.nextElementSibling.textContent = "保存済み";
      } catch (e) {
        if (element)
          element.nextElementSibling.textContent =
            "未保存：もう一度入力欄から移動すると再試行します。";
        noteError(e);
      }
    });
  memoQueues.set(id, next);
  return next;
}
let lastRun = "";
async function updateStatus() {
  if (mode !== "library") return;
  const d = await api("/api/status"),
    r = d.run;
  const titles = {
    running: "今日の論文を準備しています",
    complete: "今日の2本が届いています",
    partial: "一部の推薦を保存しました",
    error: "更新中に問題が発生しました",
  };
  $("#run-title").textContent = r ? titles[r.status] : "次の論文を待っています";
  $("#run-time").textContent =
    `${d.schedule.enabled ? "毎朝 " + d.schedule.time + " に更新" : "自動更新は停止中"} · ${d.schedule.timezone}`;
  $("#schedule-label").textContent = d.schedule.enabled
    ? "● 毎朝 " + d.schedule.time + " に更新"
    : "自動更新は停止中";
  $("#run-report").textContent = r?.report || "まだ実行記録はありません。";
  $("#generate").disabled = d.running;
  const next = JSON.stringify(r);
  if (next !== lastRun && !d.running) {
    lastRun = next;
    if (!memoDrafts.size && !document.querySelector("textarea:focus"))
      await loadPapers();
  }
}
async function refresh() {
  const next = await api("/api/state");
  const before = state?.account?.signedIn;
  state = next;
  if (state.initialized && !state.unlocked) {
    if (mode !== "unlock") unlockScreen();
    return;
  }
  if (!state.initialized) {
    if (mode === "connect" && before !== state.account.signedIn)
      connectScreen();
    else if (!["connect", "password"].includes(mode)) connectScreen();
    return;
  }
  if (!state.profile) {
    if (!["questions", "review"].includes(mode)) {
      answers = { ...state.draft.answers };
      step = state.draft.step || 0;
      schedule = state.schedule;
      questionScreen();
    }
    return;
  }
  if (!["library", "questions", "review"].includes(mode)) libraryScreen();
  else if (mode === "library") {
    $("#account-banner").hidden = state.account.signedIn;
    if (!before && state.account.signedIn) {
      toast("ChatGPTに接続しました。最初の推薦を始めます。");
      await api("/api/generate", { method: "POST" }).catch(noteError);
    }
    await updateStatus();
  }
}
$("#open-oss").onclick = async () => {
  $("#oss-dialog").showModal();
  const select = $("#oss-select");
  const text = $("#oss-text");
  select.replaceChildren();
  text.textContent = "ライセンスを読み込んでいます。";
  try {
    const response = await fetch("/static/oss/notices.json");
    if (!response.ok) throw Error("Notice asset missing");
    const documents = await response.json();
    select.replaceChildren(...documents.map(({ name }, index) => new Option(name, index)));
    select.onchange = () => { text.textContent = documents[Number(select.value)].text; };
    select.onchange();
  } catch {
    text.textContent = "ライセンスを読み込めませんでした。上のリンクから確認してください。";
  }
};
$("#close-figure").onclick = () => $("#lightbox").close();
$("#lightbox").onclick = (e) => {
  if (e.target === $("#lightbox")) $("#lightbox").close();
};
window.addEventListener("beforeunload", (e) => {
  if (memoDrafts.size) {
    e.preventDefault();
    e.returnValue = "";
  }
});
(async () => {
  try {
    const t = new URLSearchParams(location.hash.slice(1)).get("launch");
    if (t) {
      await api("/api/claim", {
        method: "POST",
        body: JSON.stringify({ token: t }),
      });
      history.replaceState(null, "", "/");
    }
    await refresh();
    poller = setInterval(() => refresh().catch(() => {}), 4000);
  } catch (e) {
    $("#startup").textContent = e.message;
  }
})();
