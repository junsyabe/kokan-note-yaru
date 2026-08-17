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

function formatDateStampWithYear(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const y = d.getFullYear();
  const wd = WEEKDAY_KANJI[d.getDay()];
  return { main: `${y}/${d.getMonth() + 1}/${d.getDate()}`, weekday: wd };
}

function stampRotation(dateStr) {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) % 7;
  return h - 3;
}

function formatTime(entryDate, createdAtIso) {
  const created = new Date(createdAtIso);
  const mm = String(created.getMinutes()).padStart(2, "0");

  const createdDateStr = dateStrFromDate(created);
  if (createdDateStr === entryDate) {
    return `${String(created.getHours()).padStart(2, "0")}:${mm}`;
  }

  const entryMidnight = new Date(entryDate + "T00:00:00");
  const createdMidnight = new Date(created.getFullYear(), created.getMonth(), created.getDate());
  const diffDays = Math.round((createdMidnight - entryMidnight) / 86400000);

  // Only true "wrote it after midnight" carries over; an entry backdated
  // ahead of when it was actually posted just shows its own clock time.
  if (diffDays <= 0) {
    return `${String(created.getHours()).padStart(2, "0")}:${mm}`;
  }

  const carriedHour = diffDays * 24 + created.getHours();
  return `${formatDateStamp(entryDate).main} ${String(carriedHour).padStart(2, "0")}:${mm}`;
}

function formatCommentTime(iso, includeDate) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  if (!includeDate) return `${hh}:${mm}`;
  return `${formatDateStamp(dateStrFromDate(d)).main} ${hh}:${mm}`;
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

function withDetail(message, err) {
  return err?.message ? `${message}（${err.message}）` : message;
}

function CommunityJoinCreateForm({
  joinCode,
  onJoinCodeChange,
  onJoin,
  joining,
  joinError,
  createName,
  onCreateNameChange,
  onCreate,
  creating,
  createError,
  createdInfo,
  onCopy,
}) {
  return (
    <div className="konote-community-form">
      <div className="konote-community-section">
        <label className="konote-field-label">招待コードで参加</label>
        <div className="konote-community-row">
          <input
            className="konote-auth-input"
            value={joinCode}
            onChange={(e) => onJoinCodeChange(e.target.value)}
            placeholder="招待コードを入力"
          />
          <button className="konote-community-btn" onClick={onJoin} disabled={joining || !joinCode.trim()}>
            {joining ? "参加中…" : "参加"}
          </button>
        </div>
        {joinError && <p className="konote-error">{joinError}</p>}
      </div>

      <div className="konote-community-divider">または</div>

      <div className="konote-community-section">
        <label className="konote-field-label">新しいコミュニティを作る</label>
        <div className="konote-community-row">
          <input
            className="konote-auth-input"
            value={createName}
            onChange={(e) => onCreateNameChange(e.target.value)}
            placeholder="コミュニティ名"
            maxLength={30}
          />
          <button className="konote-community-btn" onClick={onCreate} disabled={creating || !createName.trim()}>
            {creating ? "作成中…" : "作成"}
          </button>
        </div>
        {createError && <p className="konote-error">{createError}</p>}
      </div>

      {createdInfo && (
        <div className="konote-community-created">
          <p className="konote-community-created-label">「{createdInfo.name}」を作成しました</p>
          <label className="konote-field-label">招待コード</label>
          <div className="konote-community-row">
            <input className="konote-auth-input" value={createdInfo.invite_code} readOnly />
            <button type="button" className="konote-community-btn" onClick={() => onCopy(createdInfo.invite_code)}>
              コピー
            </button>
          </div>
          <label className="konote-field-label">招待リンク</label>
          <div className="konote-community-row">
            <input className="konote-auth-input" value={createdInfo.link} readOnly />
            <button type="button" className="konote-community-btn" onClick={() => onCopy(createdInfo.link)}>
              コピー
            </button>
          </div>
        </div>
      )}
    </div>
  );
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

  const [profileTarget, setProfileTarget] = useState(null);

  const [myCommunities, setMyCommunities] = useState([]);
  const [communitiesLoading, setCommunitiesLoading] = useState(true);
  const [currentCommunityId, setCurrentCommunityId] = useState(null);
  const [memberIds, setMemberIds] = useState([]);

  const [showCommunityModal, setShowCommunityModal] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState(null);
  const [createNameInput, setCreateNameInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [createdInfo, setCreatedInfo] = useState(null);

  const [postCommunityIds, setPostCommunityIds] = useState([]);

  // --- auth bootstrap ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const myName = session?.user?.user_metadata?.display_name || session?.user?.email || "";

  // --- communities ---
  const loadMyCommunities = useCallback(async () => {
    const { data, error } = await supabase
      .from("community_members")
      .select("community_id, communities(id, name, invite_code, created_by, created_at)")
      .eq("user_id", session.user.id);
    if (error) {
      setErrorMsg(withDetail("コミュニティ一覧の読み込みに失敗しました。", error));
    } else {
      setErrorMsg(null);
      const list = (data || [])
        .map((row) => row.communities)
        .filter(Boolean)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      setMyCommunities(list);
      setCurrentCommunityId((prev) => (prev && list.some((c) => c.id === prev) ? prev : list[0]?.id || null));
    }
    setCommunitiesLoading(false);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    setCommunitiesLoading(true);
    loadMyCommunities();
  }, [session, loadMyCommunities]);

  const handleJoinByCode = async (codeOverride) => {
    const code = (codeOverride ?? joinCodeInput).trim();
    if (!code) return;
    setJoining(true);
    setJoinError(null);
    try {
      const { data, error } = await supabase.rpc("join_community_by_code", { code });
      if (error) throw error;
      setJoinCodeInput("");
      setShowCommunityModal(false);
      await loadMyCommunities();
      if (data) setCurrentCommunityId(data);
    } catch (err) {
      setJoinError(withDetail("招待コードが見つかりませんでした。", err));
    } finally {
      setJoining(false);
    }
  };

  const handleCreateCommunity = async () => {
    const name = createNameInput.trim();
    if (!name) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { data, error } = await supabase.rpc("create_community", { community_name: name });
      if (error) throw error;
      const created = data && data[0];
      if (!created) throw new Error("empty response");
      const link = `${window.location.origin}${window.location.pathname}?invite=${created.invite_code}`;
      setCreatedInfo({ name, invite_code: created.invite_code, link });
      setCreateNameInput("");
      await loadMyCommunities();
      setCurrentCommunityId(created.id);
    } catch (err) {
      setCreateError(withDetail("コミュニティの作成に失敗しました。", err));
    } finally {
      setCreating(false);
    }
  };

  const handleCopyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      // clipboard access can be blocked (permissions/non-secure context); nothing to do
    }
  };

  // Auto-join via a shared ?invite=CODE link, once communities have loaded.
  useEffect(() => {
    if (!session || communitiesLoading) return;
    const code = new URLSearchParams(window.location.search).get("invite");
    if (!code) return;
    handleJoinByCode(code).then(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("invite");
      window.history.replaceState({}, "", url.toString());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, communitiesLoading]);

  // --- data loading + realtime ---
  const loadEntries = useCallback(async (communityId) => {
    if (!communityId) {
      setEntries([]);
      setEntriesLoading(false);
      return;
    }
    const { data: entryRows, error: entryErr } = await supabase
      .from("diary_entries")
      .select("*, entry_communities!inner(community_id)")
      .eq("entry_communities.community_id", communityId)
      .order("created_at", { ascending: true });
    if (entryErr) {
      setErrorMsg(withDetail("日記の読み込みに失敗しました。", entryErr));
      setEntriesLoading(false);
      return;
    }
    const { data: commentRows, error: commentErr } = await supabase
      .from("comments")
      .select("*")
      .eq("community_id", communityId)
      .order("created_at", { ascending: true });
    if (commentErr) {
      setErrorMsg(withDetail("コメントの読み込みに失敗しました。", commentErr));
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
    if (!session || !currentCommunityId) return;
    setEntriesLoading(true);
    loadEntries(currentCommunityId);
    const channel = supabase
      .channel(`diary-changes-${currentCommunityId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "diary_entries" }, () =>
        loadEntries(currentCommunityId)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, () =>
        loadEntries(currentCommunityId)
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "entry_communities" }, () =>
        loadEntries(currentCommunityId)
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session, currentCommunityId, loadEntries]);

  // Membership list for the current community, used to build the friend
  // filter chips (independent of who has actually posted).
  useEffect(() => {
    if (!currentCommunityId) {
      setMemberIds([]);
      return;
    }
    supabase
      .from("community_members")
      .select("user_id")
      .eq("community_id", currentCommunityId)
      .then(({ data, error }) => {
        if (!error) setMemberIds((data || []).map((m) => m.user_id));
      });
  }, [currentCommunityId]);

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
    if (!trimmed || !session || postCommunityIds.length === 0) return;
    setPosting(true);
    const { data: inserted, error } = await supabase
      .from("diary_entries")
      .insert({
        author_id: session.user.id,
        author_name: myName,
        entry_date: newDate,
        content: trimmed,
      })
      .select()
      .single();
    if (error || !inserted) {
      setPosting(false);
      setErrorMsg(withDetail("投稿に失敗しました。", error));
      return;
    }
    const { error: linkError } = await supabase
      .from("entry_communities")
      .insert(postCommunityIds.map((communityId) => ({ entry_id: inserted.id, community_id: communityId })));
    setPosting(false);
    if (linkError) {
      setErrorMsg(withDetail("コミュニティへの投稿の紐付けに失敗しました。", linkError));
      return;
    }
    setNewContent("");
    setNewDate(todayStr());
    setShowForm(false);
    loadEntries(currentCommunityId);
  };

  const handleAddComment = async (entryId) => {
    const draft = (commentDrafts[entryId] || "").trim();
    if (!draft || !session || !currentCommunityId) return;
    setPostingComment((p) => ({ ...p, [entryId]: true }));
    const { error } = await supabase.from("comments").insert({
      entry_id: entryId,
      author_id: session.user.id,
      author_name: myName,
      content: draft,
      community_id: currentCommunityId,
    });
    setPostingComment((p) => ({ ...p, [entryId]: false }));
    if (error) {
      setErrorMsg(withDetail("コメントの投稿に失敗しました。", error));
      return;
    }
    setCommentDrafts((d) => ({ ...d, [entryId]: "" }));
    loadEntries(currentCommunityId);
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
      setErrorMsg(withDetail("日記の更新に失敗しました。", error));
      return;
    }
    setEditingEntryId(null);
    setEditEntryDraft("");
    loadEntries(currentCommunityId);
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
      setErrorMsg(withDetail("コメントの更新に失敗しました。", error));
      return;
    }
    setEditingCommentId(null);
    setEditCommentDraft("");
    loadEntries(currentCommunityId);
  };

  // --- profile stats (derived from already-loaded entries, no extra queries) ---
  const profileStats = useMemo(() => {
    if (!profileTarget) return { count: 0 };
    const theirEntries = entries.filter((e) => e.author_name === profileTarget);
    const count = theirEntries.length;
    if (count === 0) {
      return { count: 0 };
    }

    const totalChars = theirEntries.reduce((sum, e) => sum + e.content.length, 0);
    const avgChars = Math.round(totalChars / count);

    const uniqueDates = Array.from(new Set(theirEntries.map((e) => e.entry_date))).sort();
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
  }, [entries, profileTarget]);

  // --- grouping ---
  // Names of the current community's members (from community_members, not
  // just whoever has posted), resolved via author_id -> author_name seen in
  // already-loaded entries/comments (no profiles table to join against).
  const authorIdToName = useMemo(() => {
    const map = {};
    entries.forEach((e) => {
      map[e.author_id] = e.author_name;
      (e.comments || []).forEach((c) => {
        map[c.author_id] = c.author_name;
      });
    });
    if (session?.user?.id) map[session.user.id] = myName;
    return map;
  }, [entries, session, myName]);

  const communityMemberNames = useMemo(
    () =>
      Array.from(new Set(memberIds.map((uid) => authorIdToName[uid]).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "ja")
      ),
    [memberIds, authorIdToName]
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

  // --- render: signed in, checking community membership ---
  if (communitiesLoading) {
    return (
      <div className="konote-app konote-loading-screen">
        <p className="konote-loading-text">読み込み中…</p>
      </div>
    );
  }

  // --- render: signed in, no community joined yet ---
  if (myCommunities.length === 0) {
    return (
      <div className="konote-app konote-onboarding">
        <div className="konote-cover">
          <div className="konote-ribbon" />
          <p className="konote-eyebrow">SHARED DIARY FOR FRIENDS</p>
          <h1 className="konote-title">こうかんノート</h1>
          <p className="konote-subtitle">コミュニティに参加または作成してください。</p>
          {errorMsg && <p className="konote-error">{errorMsg}</p>}
          <div className="konote-auth-card">
            <CommunityJoinCreateForm
              joinCode={joinCodeInput}
              onJoinCodeChange={setJoinCodeInput}
              onJoin={() => handleJoinByCode()}
              joining={joining}
              joinError={joinError}
              createName={createNameInput}
              onCreateNameChange={setCreateNameInput}
              onCreate={handleCreateCommunity}
              creating={creating}
              createError={createError}
              createdInfo={createdInfo}
              onCopy={handleCopyText}
            />
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
          <div className="konote-community-switcher">
            <select
              className="konote-community-select"
              value={currentCommunityId || ""}
              onChange={(e) => {
                setCurrentCommunityId(e.target.value);
                setSelectedAuthor(null);
              }}
              aria-label="コミュニティを切り替える"
            >
              {myCommunities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="konote-community-add-btn"
              onClick={() => {
                setJoinError(null);
                setCreateError(null);
                setShowCommunityModal(true);
              }}
              aria-label="コミュニティに参加または作成"
              title="コミュニティに参加または作成"
            >
              +
            </button>
          </div>
        </div>
        <div className="konote-me-row">
          <button
            type="button"
            className="konote-me-avatar konote-me-avatar-btn"
            style={{ background: colorForName(myName) }}
            onClick={() => setProfileTarget(myName)}
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

        {!entriesLoading && communityMemberNames.length > 0 && (
          <div className="konote-filter-row">
            <button
              className={`konote-filter-chip ${!selectedAuthor ? "is-active" : ""}`}
              onClick={() => setSelectedAuthor(null)}
            >
              すべて
            </button>
            {communityMemberNames.map((author) => (
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
                      <button
                        type="button"
                        className="konote-avatar konote-tap-avatar"
                        style={{ background: colorForName(entry.author_name) }}
                        onClick={() => setProfileTarget(entry.author_name)}
                        aria-label={`${entry.author_name}さんのプロフィールを見る`}
                      >
                        {entry.author_name.charAt(0)}
                      </button>
                      <button
                        type="button"
                        className="konote-entry-author konote-tap-name"
                        onClick={() => setProfileTarget(entry.author_name)}
                      >
                        {entry.author_name}
                      </button>
                      {entry.updated_at !== entry.created_at ? (
                        <div className="konote-entry-time-block">
                          <span className="konote-entry-time">
                            {formatTime(entry.entry_date, entry.created_at)}
                          </span>
                          <span className="konote-entry-time konote-time-edited">
                            編集 {formatTime(entry.entry_date, entry.updated_at)}
                          </span>
                        </div>
                      ) : (
                        <span className="konote-entry-time">{formatTime(entry.entry_date, entry.created_at)}</span>
                      )}
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
                          <button
                            type="button"
                            className="konote-comment-avatar konote-tap-avatar"
                            style={{ background: colorForName(c.author_name) }}
                            onClick={() => setProfileTarget(c.author_name)}
                            aria-label={`${c.author_name}さんのプロフィールを見る`}
                          >
                            {c.author_name.charAt(0)}
                          </button>
                          <div className="konote-comment-body">
                            <div className="konote-comment-meta-row">
                              <button
                                type="button"
                                className="konote-comment-author konote-tap-name"
                                onClick={() => setProfileTarget(c.author_name)}
                              >
                                {c.author_name}
                              </button>
                              {c.updated_at !== c.created_at ? (
                                (() => {
                                  const spansDates =
                                    dateStrFromDate(new Date(c.created_at)) !==
                                    dateStrFromDate(new Date(c.updated_at));
                                  return (
                                    <div className="konote-comment-time-block">
                                      <span className="konote-comment-time">
                                        {formatCommentTime(c.created_at, spansDates)}
                                      </span>
                                      <span className="konote-comment-time konote-time-edited">
                                        編集 {formatCommentTime(c.updated_at, spansDates)}
                                      </span>
                                    </div>
                                  );
                                })()
                              ) : (
                                <span className="konote-comment-time">
                                  {formatCommentTime(c.created_at, false)}
                                </span>
                              )}
                            </div>
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

      <button
        className="konote-fab"
        onClick={() => {
          setShowForm(true);
          setPostCommunityIds(currentCommunityId ? [currentCommunityId] : []);
        }}
        aria-label="日記を書く"
      >
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
            <label className="konote-field-label">投稿先コミュニティ</label>
            <div className="konote-community-checkbox-list">
              {myCommunities.map((c) => (
                <label key={c.id} className="konote-community-checkbox">
                  <input
                    type="checkbox"
                    checked={postCommunityIds.includes(c.id)}
                    onChange={(e) => {
                      setPostCommunityIds((prev) =>
                        e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id)
                      );
                    }}
                  />
                  {c.name}
                </label>
              ))}
            </div>
            <button
              className="konote-submit-btn"
              onClick={handlePost}
              disabled={!newContent.trim() || posting || postCommunityIds.length === 0}
            >
              {posting ? "投稿中…" : "ノートに書く"}
            </button>
          </div>
        </div>
      )}

      {profileTarget && (
        <div className="konote-modal-backdrop" onClick={() => setProfileTarget(null)}>
          <div className="konote-modal" onClick={(e) => e.stopPropagation()}>
            <div className="konote-modal-head">
              <h2>プロフィール</h2>
              <button className="konote-modal-close" onClick={() => setProfileTarget(null)} aria-label="閉じる">
                ✕
              </button>
            </div>

            <div className="konote-profile-head">
              <span className="konote-avatar konote-profile-avatar" style={{ background: colorForName(profileTarget) }}>
                {profileTarget.charAt(0)}
              </span>
              <span className="konote-profile-name">{profileTarget}</span>
            </div>

            {profileStats.count === 0 ? (
              <p className="konote-profile-empty">まだ投稿がありません。</p>
            ) : (
              <div className="konote-profile-stats">
                <div className="konote-profile-stat">
                  <span className="konote-profile-stat-label">投稿数</span>
                  <span className="konote-profile-stat-value">
                    {profileStats.count}
                    <span className="konote-profile-stat-unit">件</span>
                  </span>
                </div>
                <div className="konote-profile-stat">
                  <span className="konote-profile-stat-label">合計文字数</span>
                  <span className="konote-profile-stat-value">
                    {profileStats.totalChars}
                    <span className="konote-profile-stat-unit">文字</span>
                  </span>
                </div>
                <div className="konote-profile-stat">
                  <span className="konote-profile-stat-label">平均文字数</span>
                  <span className="konote-profile-stat-value">
                    {profileStats.avgChars}
                    <span className="konote-profile-stat-unit">文字</span>
                  </span>
                </div>
                <div aria-hidden="true" />
                <div className="konote-profile-stat">
                  <span className="konote-profile-stat-label">連続投稿(現在)</span>
                  <span className="konote-profile-stat-value">
                    {profileStats.currentStreak}
                    <span className="konote-profile-stat-unit">日</span>
                  </span>
                </div>
                <div className="konote-profile-stat">
                  <span className="konote-profile-stat-label">連続投稿(自己ベスト)</span>
                  <span className="konote-profile-stat-value">
                    {profileStats.bestStreak}
                    <span className="konote-profile-stat-unit">日</span>
                  </span>
                </div>
                <div className="konote-profile-stat">
                  <span className="konote-profile-stat-label">初投稿日</span>
                  <span className="konote-profile-stat-value">
                    {formatDateStampWithYear(profileStats.firstDate).main}
                    ({formatDateStampWithYear(profileStats.firstDate).weekday})
                  </span>
                </div>
                <div className="konote-profile-stat">
                  <span className="konote-profile-stat-label">最終投稿日</span>
                  <span className="konote-profile-stat-value">
                    {formatDateStampWithYear(profileStats.lastDate).main}
                    ({formatDateStampWithYear(profileStats.lastDate).weekday})
                  </span>
                </div>
              </div>
            )}

            {profileTarget === myName && (
              <button className="konote-profile-logout" onClick={handleLogout}>
                ログアウト
              </button>
            )}
          </div>
        </div>
      )}

      {showCommunityModal && (
        <div className="konote-modal-backdrop" onClick={() => setShowCommunityModal(false)}>
          <div className="konote-modal" onClick={(e) => e.stopPropagation()}>
            <div className="konote-modal-head">
              <h2>コミュニティに参加/作成</h2>
              <button
                className="konote-modal-close"
                onClick={() => setShowCommunityModal(false)}
                aria-label="閉じる"
              >
                ✕
              </button>
            </div>
            <CommunityJoinCreateForm
              joinCode={joinCodeInput}
              onJoinCodeChange={setJoinCodeInput}
              onJoin={() => handleJoinByCode()}
              joining={joining}
              joinError={joinError}
              createName={createNameInput}
              onCreateNameChange={setCreateNameInput}
              onCreate={handleCreateCommunity}
              creating={creating}
              createError={createError}
              createdInfo={createdInfo}
              onCopy={handleCopyText}
            />
          </div>
        </div>
      )}
    </div>
  );
}
