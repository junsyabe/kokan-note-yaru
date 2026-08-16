"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";

const AUTHOR_COLORS = ["#2D6A93", "#93445B", "#4C7A5D", "#8B5FA0", "#B9762F", "#3E6B6B"];
const WEEKDAY_KANJI = ["日", "月", "火", "水", "木", "金", "土"];
const INVITE_CODE = process.env.NEXT_PUBLIC_INVITE_CODE || "";

function colorForName(name) {
  if (!name) return AUTHOR_COLORS[0];
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AUTHOR_COLORS[sum % AUTHOR_COLORS.length];
}

function formatDateStamp(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const wd = WEEKDAY_KANJI[d.getDay()];
  return { main: `${m}/${day}`, weekday: wd };
}

function stampRotation(dateStr) {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) % 7;
  return h - 3;
}

function formatTime(iso) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function dateStrFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return dateStrFromDate(new Date());
}

export default function HomePage() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out
  const [mode, setMode] = useState("login"); // 'login' | 'signup'
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [authError, setAuthError] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState(null);

  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [selectedAuthor, setSelectedAuthor] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [newDate, setNewDate] = useState(todayStr());
  const [posting, setPosting] = useState(false);

  const [commentDrafts, setCommentDrafts] = useState({});
  const [postingComment, setPostingComment] = useState({});

  const [editingEntryId, setEditingEntryId] = useState(null);
  const [editEntryDraft, setEditEntryDraft] = useState("");
  const [savingEntryEdit, setSavingEntryEdit] = useState(false);

  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editCommentDraft, setEditCommentDraft] = useState("");
  const [savingCommentEdit, setSavingCommentEdit] = useState(false);

  const [showProfile, setShowProfile] = useState(false);

  // --- auth bootstrap ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const myName = session?.user?.user_metadata?.display_name || session?.user?.email || "";

  // --- data loading + realtime ---
  const loadEntries = useCallback(async () => {
    const { data: entryRows, error: entryErr } = await supabase
      .from("diary_entries")
      .select("*")
      .order("created_at", { ascending: true });
    if (entryErr) {
      setErrorMsg("日記の読み込みに失敗しました。");
      setEntriesLoading(false);
      return;
    }
    const { data: commentRows, error: commentErr } = await supabase
      .from("comments")
      .select("*")
      .order("created_at", { ascending: true });
    if (commentErr) {
      setErrorMsg("コメントの読み込みに失敗しました。");
    } else {
      setErrorMsg(null);
    }
    const byEntry = {};
    (commentRows || []).forEach((c) => {
      if (!byEntry[c.entry_id]) byEntry[c.entry_id] = [];
      byEntry[c.entry_id].push(c);
    });
    setEntries((entryRows || []).map((e) => ({ ...e, comments: byEntry[e.id] || [] })));
    setEntriesLoading(false);
  }, []);

  useEffect(() => {
    if (!session) return;
    setEntriesLoading(true);
    loadEntries();
    const channel = supabase
      .channel("diary-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "diary_entries" }, loadEntries)
      .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, loadEntries)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, loadEntries]);

  // --- auth actions ---
  const handleSignup = async () => {
    setAuthError(null);
    setAuthNotice(null);
    if (INVITE_CODE && inviteInput.trim() !== INVITE_CODE) {
      setAuthError("招待コードが正しくありません。");
      return;
    }
    if (!displayName.trim()) {
      setAuthError("名前を入力してください。");
      return;
    }
    setAuthBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName.trim() } },
    });
    setAuthBusy(false);
    if (error) {
      setAuthError(error.message);
      return;
    }
    setAuthNotice("確認メールを送りました。メール内のリンクを開いてからログインしてください。");
  };

  const handleLogin = async () => {
    setAuthError(null);
    setAuthBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setAuthBusy(false);
    if (error) setAuthError(error.message);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // --- entry / comment actions ---
  const handlePost = async () => {
    const trimmed = newContent.trim();
    if (!trimmed || !session) return;
    setPosting(true);
    const { error } = await supabase.from("diary_entries").insert({
      author_id: session.user.id,
      author_name: myName,
      entry_date: newDate,
      content: trimmed,
    });
    setPosting(false);
    if (error) {
      setErrorMsg("投稿に失敗しました。");
      return;
    }
    setNewContent("");
    setNewDate(todayStr());
    setShowForm(false);
    loadEntries();
  };

  const handleAddComment = async (entryId) => {
    const draft = (commentDrafts[entryId] || "").trim();
    if (!draft || !session) return;
    setPostingComment((p) => ({ ...p, [entryId]: true }));
    const { error } = await supabase.from("comments").insert({
      entry_id: entryId,
      author_id: session.user.id,
      author_name: myName,
      content: draft,
    });
    setPostingComment((p) => ({ ...p, [entryId]: false }));
    if (error) {
      setErrorMsg("コメントの投稿に失敗しました。");
      return;
    }
    setCommentDrafts((d) => ({ ...d, [entryId]: "" }));
    loadEntries();
  };

  const startEditEntry = (entry) => {
    setEditingEntryId(entry.id);
    setEditEntryDraft(entry.content);
  };

  const cancelEditEntry = () => {
    setEditingEntryId(null);
    setEditEntryDraft("");
  };

  const saveEditEntry = async (entryId) => {
    const trimmed = editEntryDraft.trim();
    if (!trimmed) return;
    setSavingEntryEdit(true);
    const { error } = await supabase
      .from("diary_entries")
      .update({ content: trimmed, updated_at: new Date().toISOString() })
      .eq("id", entryId);
    setSavingEntryEdit(false);
    if (error) {
      setErrorMsg("日記の更新に失敗しました。");
      return;
    }
    setEditingEntryId(null);
    setEditEntryDraft("");
    loadEntries();
  };

  const startEditComment = (comment) => {
    setEditingCommentId(comment.id);
    setEditCommentDraft(comment.content);
  };

  const cancelEditComment = () => {
    setEditingCommentId(null);
    setEditCommentDraft("");
  };

  const saveEditComment = async (commentId) => {
    const trimmed = editCommentDraft.trim();
    if (!trimmed) return;
    setSavingCommentEdit(true);
    const { error } = await supabase
      .from("comments")
      .update({ content: trimmed, updated_at: new Date().toISOString() })
      .eq("id", commentId);
    setSavingCommentEdit(false);
    if (error) {
      setErrorMsg("コメントの更新に失敗しました。");
      return;
    }
    setEditingCommentId(null);
    setEditCommentDraft("");
    loadEntries();
  };

  // --- profile stats (derived from already-loaded entries, no extra queries) ---
  const profileStats = useMemo(() => {
    const myEntries = entries.filter((e) => e.author_name === myName);
    const count = myEntries.length;
    if (count === 0) {
      return { count: 0 };
    }

    const totalChars = myEntries.reduce((sum, e) => sum + e.content.length, 0);
    const avgChars = Math.round(totalChars / count);

    const uniqueDates = Array.from(new Set(myEntries.map((e) => e.entry_date))).sort();
    const firstDate = uniqueDates[0];
    const lastDate = uniqueDates[uniqueDates.length - 1];

    let bestStreak = 1;
    let run = 1;
    for (let i = 1; i < uniqueDates.length; i++) {
      const prev = new Date(uniqueDates[i - 1] + "T00:00:00");
      const cur = new Date(uniqueDates[i] + "T00:00:00");
      const diffDays = Math.round((cur - prev) / 86400000);
      run = diffDays === 1 ? run + 1 : 1;
      if (run > bestStreak) bestStreak = run;
    }

    const dateSet = new Set(uniqueDates);
    const today = todayStr();
    const yesterday = dateStrFromDate(new Date(Date.now() - 86400000));
    let currentStreak = 0;
    let cursorDate = dateSet.has(today) ? today : dateSet.has(yesterday) ? yesterday : null;
    if (cursorDate) {
      let cursor = new Date(cursorDate + "T00:00:00");
      while (dateSet.has(dateStrFromDate(cursor))) {
        currentStreak += 1;
        cursor = new Date(cursor.getTime() - 86400000);
      }
    }

    return { count, totalChars, avgChars, firstDate, lastDate, currentStreak, bestStreak };
  }, [entries, myName]);

  // --- grouping ---
  const uniqueAuthors = useMemo(
    () =>
      Array.from(new Set(entries.map((e) => e.author_name))).sort((a, b) =>
        a.localeCompare(b, "ja")
      ),
    [entries]
  );
  const filteredEntries = selectedAuthor
    ? entries.filter((e) => e.author_name === selectedAuthor)
    : entries;
  const groups = {};
  filteredEntries.forEach((e) => {
    if (!groups[e.entry_date]) groups[e.entry_date] = [];
    groups[e.entry_date].push(e);
  });
  const sortedDates = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
  Object.values(groups).forEach((list) =>
    list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  );

  // --- render: loading ---
  if (session === undefined) {
    return (
      <div className="konote-app konote-loading-screen">
        <p className="konote-loading-text">読み込み中…</p>
      </div>
    );
  }

  // --- render: signed out (login / signup) ---
  if (!session) {
    return (
      <div className="konote-app konote-onboarding">
        <div className="konote-cover">
          <div className="konote-ribbon" />
          <p className="konote-eyebrow">SHARED DIARY FOR FRIENDS</p>
          <h1 className="konote-title">こうかんノート</h1>
          <p className="konote-subtitle">友達と日記を回覧する、みんなの共有ノート。</p>

          <div className="konote-auth-toggle">
            <button
              className={mode === "login" ? "is-active" : ""}
              onClick={() => {
                setMode("login");
                setAuthError(null);
                setAuthNotice(null);
              }}
            >
              ログイン
            </button>
            <button
              className={mode === "signup" ? "is-active" : ""}
              onClick={() => {
                setMode("signup");
                setAuthError(null);
                setAuthNotice(null);
              }}
            >
              はじめて参加する
            </button>
          </div>

          <div className="konote-auth-card">
            {mode === "signup" && (
              <>
                {INVITE_CODE && (
                  <>
                    <label className="konote-field-label">招待コード</label>
                    <input
                      className="konote-auth-input"
                      value={inviteInput}
                      onChange={(e) => setInviteInput(e.target.value)}
                      placeholder="友達から聞いたコード"
                    />
                  </>
                )}
                <label className="konote-field-label">なまえ</label>
                <input
                  className="konote-auth-input"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="ノートに表示する名前"
                  maxLength={20}
                />
              </>
            )}
            <label className="konote-field-label">メールアドレス</label>
            <input
              className="konote-auth-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <label className="konote-field-label">パスワード</label>
            <input
              className="konote-auth-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6文字以上"
            />
            <button
              className="konote-join-btn"
              onClick={mode === "signup" ? handleSignup : handleLogin}
              disabled={authBusy || !email.trim() || !password.trim()}
            >
              {authBusy ? "処理中…" : mode === "signup" ? "参加する" : "ログイン"}
            </button>
            {authError && <p className="konote-error">{authError}</p>}
            {authNotice && <p className="konote-error" style={{ color: "#2D6A93" }}>{authNotice}</p>}
          </div>
        </div>
      </div>
    );
  }

  // --- render: signed in (diary feed) ---
  return (
    <div className="konote-app">
      <header className="konote-header">
        <div className="konote-ribbon" />
        <div className="konote-header-top">
          <div>
            <p className="konote-eyebrow">SHARED DIARY FOR FRIENDS</p>
            <h1 className="konote-title-sm">こうかんノート</h1>
          </div>
        </div>
        <div className="konote-me-row">
          <button
            type="button"
            className="konote-me-avatar konote-me-avatar-btn"
            style={{ background: colorForName(myName) }}
            onClick={() => setShowProfile(true)}
            aria-label="プロフィールを表示"
            title="プロフィールを表示"
          >
            {myName.charAt(0)}
          </button>
          <span className="konote-me-name">{myName} さんとして参加中</span>
        </div>
      </header>

      <main className="konote-page">
        {errorMsg && <div className="konote-error-banner">{errorMsg}</div>}

        {!entriesLoading && uniqueAuthors.length > 0 && (
          <div className="konote-filter-row">
            <button
              className={`konote-filter-chip ${!selectedAuthor ? "is-active" : ""}`}
              onClick={() => setSelectedAuthor(null)}
            >
              すべて
            </button>
            {uniqueAuthors.map((author) => (
              <button
                key={author}
                className={`konote-filter-chip ${selectedAuthor === author ? "is-active" : ""}`}
                onClick={() => setSelectedAuthor(author)}
              >
                <span className="konote-filter-avatar" style={{ background: colorForName(author) }}>
                  {author.charAt(0)}
                </span>
                {author}
              </button>
            ))}
          </div>
        )}

        {entriesLoading ? (
          <p className="konote-loading-text" style={{ color: "var(--muted-text)" }}>
            日記を読み込んでいます…
          </p>
        ) : sortedDates.length === 0 ? (
          <div className="konote-empty">
            {selectedAuthor ? (
              <p>{selectedAuthor}さんの日記はまだありません。</p>
            ) : (
              <>
                <p>まだ日記がありません。</p>
                <p>今日あった出来事を書いてみましょう。</p>
              </>
            )}
          </div>
        ) : (
          sortedDates.map((date) => {
            const stamp = formatDateStamp(date);
            return (
              <section key={date} className="konote-date-group">
                <div
                  className="konote-date-stamp"
                  style={{ transform: `rotate(${stampRotation(date)}deg)` }}
                >
                  <span className="konote-stamp-date">{stamp.main}</span>
                  <span className="konote-stamp-weekday">({stamp.weekday})</span>
                </div>
                {groups[date].map((entry) => (
                  <article className="konote-entry" key={entry.id}>
                    <span className="konote-entry-tab" style={{ background: colorForName(entry.author_name) }} />
                    <div className="konote-entry-head">
                      <span className="konote-avatar" style={{ background: colorForName(entry.author_name) }}>
                        {entry.author_name.charAt(0)}
                      </span>
                      <span className="konote-entry-author">{entry.author_name}</span>
                      {entry.updated_at !== entry.created_at && (
                        <span className="konote-edited-tag">(編集済み)</span>
                      )}
                      <span className="konote-entry-time">{formatTime(entry.created_at)}</span>
                      {entry.author_id === session.user.id && editingEntryId !== entry.id && (
                        <button
                          className="konote-edit-btn"
                          onClick={() => startEditEntry(entry)}
                          aria-label="日記を編集"
                          title="編集"
                        >
                          ✎
                        </button>
                      )}
                    </div>
                    {editingEntryId === entry.id ? (
                      <div className="konote-edit-block">
                        <textarea
                          className="konote-edit-textarea"
                          value={editEntryDraft}
                          onChange={(e) => setEditEntryDraft(e.target.value)}
                          rows={4}
                          maxLength={2000}
                        />
                        <div className="konote-edit-actions">
                          <button
                            className="konote-edit-cancel"
                            onClick={cancelEditEntry}
                            disabled={savingEntryEdit}
                          >
                            キャンセル
                          </button>
                          <button
                            className="konote-edit-save"
                            onClick={() => saveEditEntry(entry.id)}
                            disabled={!editEntryDraft.trim() || savingEntryEdit}
                          >
                            {savingEntryEdit ? "保存中…" : "保存"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="konote-entry-content">{entry.content}</p>
                    )}

                    <div className="konote-comments">
                      {(entry.comments || []).map((c) => (
                        <div className="konote-comment" key={c.id}>
                          <span className="konote-comment-avatar" style={{ background: colorForName(c.author_name) }}>
                            {c.author_name.charAt(0)}
                          </span>
                          <div className="konote-comment-body">
                            <span className="konote-comment-author">
                              {c.author_name}
                              {c.updated_at !== c.created_at && (
                                <span className="konote-edited-tag-sm">(編集済み)</span>
                              )}
                            </span>
                            {editingCommentId === c.id ? (
                              <div className="konote-edit-block konote-edit-block-sm">
                                <textarea
                                  className="konote-edit-textarea"
                                  value={editCommentDraft}
                                  onChange={(e) => setEditCommentDraft(e.target.value)}
                                  rows={2}
                                  maxLength={200}
                                />
                                <div className="konote-edit-actions">
                                  <button
                                    className="konote-edit-cancel"
                                    onClick={cancelEditComment}
                                    disabled={savingCommentEdit}
                                  >
                                    キャンセル
                                  </button>
                                  <button
                                    className="konote-edit-save"
                                    onClick={() => saveEditComment(c.id)}
                                    disabled={!editCommentDraft.trim() || savingCommentEdit}
                                  >
                                    {savingCommentEdit ? "保存中…" : "保存"}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <span className="konote-comment-text">{c.content}</span>
                            )}
                          </div>
                          {c.author_id === session.user.id && editingCommentId !== c.id && (
                            <button
                              className="konote-edit-btn konote-edit-btn-sm"
                              onClick={() => startEditComment(c)}
                              aria-label="コメントを編集"
                              title="編集"
                            >
                              ✎
                            </button>
                          )}
                        </div>
                      ))}
                      <div className="konote-comment-form">
                        <input
                          className="konote-comment-input"
                          placeholder="ひとこと残す…"
                          value={commentDrafts[entry.id] || ""}
                          onChange={(e) => setCommentDrafts((d) => ({ ...d, [entry.id]: e.target.value }))}
                          onKeyDown={(e) => e.key === "Enter" && handleAddComment(entry.id)}
                          maxLength={200}
                        />
                        <button
                          className="konote-comment-send"
                          onClick={() => handleAddComment(entry.id)}
                          disabled={!(commentDrafts[entry.id] || "").trim() || postingComment[entry.id]}
                          aria-label="コメントを送る"
                        >
                          ➤
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            );
          })
        )}
      </main>

      <button className="konote-fab" onClick={() => setShowForm(true)} aria-label="日記を書く">
        ＋
      </button>

      {showForm && (
        <div className="konote-modal-backdrop" onClick={() => !posting && setShowForm(false)}>
          <div className="konote-modal" onClick={(e) => e.stopPropagation()}>
            <div className="konote-modal-head">
              <h2>今日の一言</h2>
              <button className="konote-modal-close" onClick={() => setShowForm(false)} aria-label="閉じる">
                ✕
              </button>
            </div>
            <label className="konote-field-label">日付</label>
            <input
              type="date"
              className="konote-date-input"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
            <label className="konote-field-label">今日の出来事</label>
            <textarea
              className="konote-textarea"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="今日はどんな一日だった？"
              rows={5}
              maxLength={2000}
            />
            <button className="konote-submit-btn" onClick={handlePost} disabled={!newContent.trim() || posting}>
              {posting ? "投稿中…" : "ノートに書く"}
            </button>
          </div>
        </div>
      )}

      {showProfile && (
        <div className="konote-modal-backdrop" onClick={() => setShowProfile(false)}>
          <div className="konote-modal" onClick={(e) => e.stopPropagation()}>
            <div className="konote-modal-head">
              <h2>プロフィール</h2>
              <button className="konote-modal-close" onClick={() => setShowProfile(false)} aria-label="閉じる">
                ✕
              </button>
            </div>

            <div className="konote-profile-head">
              <span className="konote-avatar konote-profile-avatar" style={{ background: colorForName(myName) }}>
                {myName.charAt(0)}
              </span>
              <span className="konote-profile-name">{myName}</span>
            </div>

            {profileStats.count === 0 ? (
              <p className="konote-profile-empty">まだ投稿がありません。</p>
            ) : (
              <div className="konote-profile-stats">
                <div className="konote-profile-stat">
                  <span className="konote-profile-stat-label">投稿数</span>
                  <span className="konote-profile-stat-value">{profileStats.count}件</span>
                </div>
                <div className="konote-profile-stat">
                  <span className="konote-profile-stat-label">合計文字数</span>
                  <span className="konote-profile-stat-value">{profileStats.totalChars}文字</span>
                </div>
                <div className="konote-profile-stat">
                  <span className="konote-profile-stat-label">平均文字数</span>
                  <span className="konote-profile-stat-value">{profileStats.avgChars}文字</span>
                </div>
                <div className="konote-profile-stat">
                  <span className="konote-profile-stat-label">連続投稿(現在)</span>
                  <span className="konote-profile-stat-value">{profileStats.currentStreak}日</span>
                </div>
                <div className="konote-profile-stat">
                  <span className="konote-profile-stat-label">初投稿日</span>
                  <span className="konote-profile-stat-value">
                    {formatDateStamp(profileStats.firstDate).main}({formatDateStamp(profileStats.firstDate).weekday})
                  </span>
                </div>
                <div className="konote-profile-stat">
                  <span className="konote-profile-stat-label">最終投稿日</span>
                  <span className="konote-profile-stat-value">
                    {formatDateStamp(profileStats.lastDate).main}({formatDateStamp(profileStats.lastDate).weekday})
                  </span>
                </div>
                <div className="konote-profile-stat">
                  <span className="konote-profile-stat-label">連続投稿(自己ベスト)</span>
                  <span className="konote-profile-stat-value">{profileStats.bestStreak}日</span>
                </div>
              </div>
            )}

            <button className="konote-profile-logout" onClick={handleLogout}>
              ログアウト
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
