(() => {
  const DRAFT_STEPS = [
    { team: "A", type: "ban", label: "A Ban 1" },
    { team: "B", type: "ban", label: "B Ban 1" },
    { team: "A", type: "ban", label: "A Ban 2" },
    { team: "B", type: "ban", label: "B Ban 2" },
    { team: "A", type: "pick", label: "A Pick 1" },
    { team: "B", type: "pick", label: "B Pick 1" },
    { team: "B", type: "pick", label: "B Pick 2" },
    { team: "A", type: "pick", label: "A Pick 2" },
    { team: "A", type: "pick", label: "A Pick 3" },
    { team: "B", type: "pick", label: "B Pick 3" },
    { team: "A", type: "ban", label: "A Ban 3" },
    { team: "B", type: "ban", label: "B Ban 3" },
    { team: "A", type: "ban", label: "A Ban 4" },
    { team: "B", type: "ban", label: "B Ban 4" },
    { team: "B", type: "pick", label: "B Pick 4" },
    { team: "A", type: "pick", label: "A Pick 4" },
    { team: "A", type: "pick", label: "A Pick 5" },
    { team: "B", type: "pick", label: "B Pick 5" }
  ];

  const TURN_SECONDS = 45;
  const $ = (id) => document.getElementById(id);

  const els = {
    connectionStatus: $("connectionStatus"),
    setupPanel: $("setupPanel"),
    roomPanel: $("roomPanel"),
    createRoomBtn: $("createRoomBtn"),
    joinRoomBtn: $("joinRoomBtn"),
    roomIdInput: $("roomIdInput"),
    firebaseNotice: $("firebaseNotice"),
    roomCodeDisplay: $("roomCodeDisplay"),
    copyRoomBtn: $("copyRoomBtn"),
    roomStatusDisplay: $("roomStatusDisplay"),
    sidePicker: $("sidePicker"),
    currentTurnText: $("currentTurnText"),
    currentTurnHelp: $("currentTurnHelp"),
    timerValue: $("timerValue"),
    startDraftBtn: $("startDraftBtn"),
    copyResultBtn: $("copyResultBtn"),
    deleteRoomBtn: $("deleteRoomBtn"),
    leaveRoomBtn: $("leaveRoomBtn"),
    teamABans: $("teamABans"),
    teamBBans: $("teamBBans"),
    teamAPicks: $("teamAPicks"),
    teamBPicks: $("teamBPicks"),
    teamAState: $("teamAState"),
    teamBState: $("teamBState"),
    heroSearch: $("heroSearch"),
    laneFilter: $("laneFilter"),
    draftSequence: $("draftSequence"),
    heroGrid: $("heroGrid"),
    toast: $("toast")
  };

  let db = null;
  let auth = null;
  let currentUser = null;
  let currentRoomId = null;
  let currentRoom = null;
  let currentRole = null;
  let unsubscribeRoom = null;
  let timerInterval = null;
  let heroes = Array.isArray(window.HCI_HEROES) ? [...window.HCI_HEROES] : [];

  function isConfigReady() {
    const cfg = window.HCI_FIREBASE_CONFIG;
    if (!cfg || typeof cfg !== "object") return false;
    return cfg.apiKey && !String(cfg.apiKey).includes("PASTE") && cfg.projectId && !String(cfg.projectId).includes("PASTE");
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { els.toast.hidden = true; }, 2600);
  }

  function heroById(id) {
    return heroes.find((hero) => hero.id === id) || null;
  }

  function heroLabel(id) {
    const hero = heroById(id);
    return hero ? hero.name : id || "-";
  }

  function heroInitials(name) {
    return String(name || "?")
      .split(/\s+|\.|-/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";
  }

  function generateRoomId() {
    return `HCI-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  async function loadHeroesFromFirestore() {
    try {
      const snapshot = await db.collection("heroes").orderBy("name").get();
      if (!snapshot.empty) {
        heroes = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      }
    } catch (error) {
      console.warn("Fallback ke heroes.js:", error.message);
    }
  }

  async function initFirebase() {
    if (!isConfigReady()) {
      els.connectionStatus.textContent = "Firebase belum disetup";
      els.firebaseNotice.hidden = false;
      renderHeroGrid();
      renderDraftSequence();
      return;
    }

    try {
      firebase.initializeApp(window.HCI_FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();

      await auth.setPersistence(firebase.auth.Auth.Persistence.NONE);
      const credential = await auth.signInAnonymously();
      currentUser = credential.user;

      await loadHeroesFromFirestore();

      els.connectionStatus.textContent = "Realtime siap";
      els.createRoomBtn.disabled = false;
      els.joinRoomBtn.disabled = false;
      renderHeroGrid();
      renderDraftSequence();
    } catch (error) {
      els.connectionStatus.textContent = "Firebase error";
      els.firebaseNotice.hidden = false;
      showToast(error.message);
      console.error(error);
    }
  }

  function baseRoomData(roomId) {
    return {
      id: roomId,
      status: "lobby",
      hostUid: currentUser.uid,
      teamAUid: currentUser.uid,
      teamBUid: "",
      teamAName: "Team A",
      teamBName: "Team B",
      turnIndex: 0,
      turnSeconds: TURN_SECONDS,
      bansA: [],
      bansB: [],
      picksA: [],
      picksB: [],
      selectedHeroIds: [],
      draftSteps: DRAFT_STEPS,
      currentTurnStartedAt: null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
  }

  async function createRoom() {
    try {
      let roomId = generateRoomId();
      let ref = db.collection("draftRooms").doc(roomId);
      let doc = await ref.get();
      while (doc.exists) {
        roomId = generateRoomId();
        ref = db.collection("draftRooms").doc(roomId);
        doc = await ref.get();
      }

      await ref.set(baseRoomData(roomId));
      currentRole = "A";
      listenRoom(roomId);
      showToast(`Room ${roomId} dibuat`);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function joinRoom() {
    const roomId = els.roomIdInput.value.trim().toUpperCase();
    if (!roomId) return showToast("Masukkan Room ID dulu.");

    try {
      const doc = await db.collection("draftRooms").doc(roomId).get();
      if (!doc.exists) return showToast("Room tidak ditemukan.");
      currentRole = "SPECTATOR";
      listenRoom(roomId);
      showToast(`Masuk ${roomId} sebagai spectator. Pilih sisi jika tersedia.`);
    } catch (error) {
      showToast(error.message);
    }
  }

  function listenRoom(roomId) {
    if (unsubscribeRoom) unsubscribeRoom();
    currentRoomId = roomId;
    unsubscribeRoom = db.collection("draftRooms").doc(roomId).onSnapshot((doc) => {
      if (!doc.exists) {
        showToast("Room sudah dihapus / tidak tersedia.");
        resetLocalState();
        return;
      }
      currentRoom = doc.data();
      renderRoom();
    }, (error) => showToast(error.message));

    els.setupPanel.hidden = true;
    els.roomPanel.hidden = false;
  }

  async function chooseSide(side) {
    if (!currentRoom || !currentRoomId) return;
    if (side === "SPECTATOR") {
      currentRole = "SPECTATOR";
      renderRoom();
      return showToast("Masuk sebagai spectator.");
    }

    const field = side === "A" ? "teamAUid" : "teamBUid";
    if (currentRoom[field] && currentRoom[field] !== currentUser.uid) {
      return showToast(`Team ${side} sudah terisi. Jika refresh, buat room baru.`);
    }

    try {
      await db.collection("draftRooms").doc(currentRoomId).update({
        [field]: currentUser.uid,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      currentRole = side;
      renderRoom();
      showToast(`Masuk sebagai Team ${side}.`);
    } catch (error) {
      showToast(error.message);
    }
  }

  async function startDraft() {
    if (!currentRoom || !currentRoomId) return;
    if (currentRoom.hostUid !== currentUser.uid && currentRole !== "A") return showToast("Hanya host / Team A yang bisa memulai draft.");
    if (!currentRoom.teamBUid) return showToast("Team B belum masuk.");

    try {
      await db.collection("draftRooms").doc(currentRoomId).update({
        status: "drafting",
        turnIndex: 0,
        currentTurnStartedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      showToast(error.message);
    }
  }

  async function selectHero(hero) {
    if (!currentRoom || !currentRoomId || !hero) return;
    if (!hero.active) return showToast("Hero ini sedang disabled.");
    if (currentRoom.status !== "drafting") return showToast("Draft belum dimulai.");
    const step = DRAFT_STEPS[currentRoom.turnIndex];
    if (!step) return showToast("Draft sudah selesai.");
    if (currentRole !== step.team) return showToast(`Sekarang giliran Team ${step.team}.`);
    if (currentRoom.selectedHeroIds?.includes(hero.id)) return showToast("Hero sudah dipilih / diban.");

    const ref = db.collection("draftRooms").doc(currentRoomId);

    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Room tidak ditemukan.");
        const room = snap.data();
        const liveStep = DRAFT_STEPS[room.turnIndex];
        if (!liveStep) throw new Error("Draft sudah selesai.");
        if (liveStep.team !== currentRole) throw new Error(`Sekarang giliran Team ${liveStep.team}.`);
        if ((room.selectedHeroIds || []).includes(hero.id)) throw new Error("Hero sudah dipilih / diban.");

        const field = liveStep.type === "ban"
          ? (liveStep.team === "A" ? "bansA" : "bansB")
          : (liveStep.team === "A" ? "picksA" : "picksB");

        const nextTurnIndex = room.turnIndex + 1;
        const nextStatus = nextTurnIndex >= DRAFT_STEPS.length ? "finished" : "drafting";

        tx.update(ref, {
          [field]: firebase.firestore.FieldValue.arrayUnion(hero.id),
          selectedHeroIds: firebase.firestore.FieldValue.arrayUnion(hero.id),
          turnIndex: nextTurnIndex,
          status: nextStatus,
          currentTurnStartedAt: nextStatus === "drafting" ? firebase.firestore.FieldValue.serverTimestamp() : null,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
    } catch (error) {
      showToast(error.message);
    }
  }

  async function deleteRoom() {
    if (!currentRoom || currentRoom.hostUid !== currentUser.uid) return showToast("Hanya host yang bisa hapus room.");
    if (!confirm("Hapus room ini?")) return;
    try {
      await db.collection("draftRooms").doc(currentRoomId).delete();
      resetLocalState();
    } catch (error) {
      showToast(error.message);
    }
  }

  function resetLocalState() {
    if (unsubscribeRoom) unsubscribeRoom();
    unsubscribeRoom = null;
    currentRoomId = null;
    currentRoom = null;
    currentRole = null;
    els.setupPanel.hidden = false;
    els.roomPanel.hidden = true;
    els.roomIdInput.value = "";
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function renderRoom() {
    if (!currentRoom) return;

    els.roomCodeDisplay.textContent = currentRoom.id || currentRoomId;
    els.roomStatusDisplay.textContent = currentRoom.status === "drafting" ? "Drafting" : currentRoom.status === "finished" ? "Finished" : "Lobby";
    els.teamAState.textContent = currentRoom.teamAUid ? (currentRole === "A" ? "Kamu" : "Terisi") : "Kosong";
    els.teamBState.textContent = currentRoom.teamBUid ? (currentRole === "B" ? "Kamu" : "Terisi") : "Kosong";

    document.querySelectorAll(".side-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.side === currentRole));

    const isHost = currentRoom.hostUid === currentUser.uid;
    els.startDraftBtn.hidden = !(currentRoom.status === "lobby" && (isHost || currentRole === "A"));
    els.copyResultBtn.hidden = !(currentRoom.status === "finished");
    els.deleteRoomBtn.hidden = !isHost;

    renderSlots(els.teamABans, currentRoom.bansA || [], 4, "Ban");
    renderSlots(els.teamBBans, currentRoom.bansB || [], 4, "Ban");
    renderSlots(els.teamAPicks, currentRoom.picksA || [], 5, "Pick");
    renderSlots(els.teamBPicks, currentRoom.picksB || [], 5, "Pick");
    renderCurrentTurn();
    renderDraftSequence();
    renderHeroGrid();
    startTimerRenderer();
  }

  function renderSlots(container, values, count, prefix) {
    container.innerHTML = "";
    for (let index = 0; index < count; index++) {
      const heroId = values[index];
      const div = document.createElement("div");
      div.className = `slot ${heroId ? "filled" : ""}`;
      div.innerHTML = heroId
        ? `<span>${heroLabel(heroId)}<small>${prefix} ${index + 1}</small></span>`
        : `<span>${prefix} ${index + 1}</span>`;
      container.appendChild(div);
    }
  }

  function renderCurrentTurn() {
    if (!currentRoom) return;

    if (currentRoom.status === "lobby") {
      els.currentTurnText.textContent = "Menunggu draft dimulai";
      els.currentTurnHelp.textContent = currentRoom.teamBUid ? "Team B sudah masuk. Host bisa mulai draft." : "Bagikan Room ID ke Team B.";
      els.timerValue.textContent = "--";
      return;
    }

    if (currentRoom.status === "finished") {
      els.currentTurnText.textContent = "Draft selesai";
      els.currentTurnHelp.textContent = "Copy result untuk bahan evaluasi coach/analis.";
      els.timerValue.textContent = "Done";
      return;
    }

    const step = DRAFT_STEPS[currentRoom.turnIndex];
    els.currentTurnText.textContent = `Team ${step.team} ${step.type.toUpperCase()}`;
    els.currentTurnHelp.textContent = currentRole === step.team ? "Giliran kamu. Pilih hero dari database." : `Menunggu Team ${step.team} memilih hero.`;
  }

  function renderDraftSequence() {
    els.draftSequence.innerHTML = "";
    DRAFT_STEPS.forEach((step, index) => {
      const chip = document.createElement("span");
      chip.className = "step-chip";
      if (currentRoom) {
        if (index < currentRoom.turnIndex) chip.classList.add("done");
        if (index === currentRoom.turnIndex && currentRoom.status === "drafting") chip.classList.add("active");
      }
      chip.textContent = step.label;
      els.draftSequence.appendChild(chip);
    });
  }

  function renderHeroGrid() {
    const search = (els.heroSearch?.value || "").trim().toLowerCase();
    const lane = els.laneFilter?.value || "ALL";
    const selected = currentRoom?.selectedHeroIds || [];
    const step = currentRoom?.status === "drafting" ? DRAFT_STEPS[currentRoom.turnIndex] : null;
    const canClick = step && currentRole === step.team;

    const filtered = heroes.filter((hero) => {
      const matchesSearch = !search || hero.name.toLowerCase().includes(search);
      const lanes = Array.isArray(hero.lanes) ? hero.lanes : [];
      const matchesLane = lane === "ALL" || lanes.includes(lane);
      return matchesSearch && matchesLane;
    });

    els.heroGrid.innerHTML = "";

    filtered.forEach((hero) => {
      const locked = selected.includes(hero.id);
      const disabledHero = hero.active === false;
      const btn = document.createElement("button");
      btn.className = `hero-card ${locked ? "locked" : ""} ${disabledHero ? "disabled-hero" : ""}`;
      btn.disabled = locked || disabledHero || !canClick;

      const avatar = hero.image
        ? `<span class="hero-avatar"><img src="${escapeHtml(hero.image)}" alt="${escapeHtml(hero.name)}" onerror="this.parentElement.textContent='${heroInitials(hero.name)}'" /></span>`
        : `<span class="hero-avatar">${heroInitials(hero.name)}</span>`;

      btn.innerHTML = `
        <span>${avatar}</span>
        <span>
          <span class="hero-name">${escapeHtml(hero.name)}</span>
          <span class="hero-lanes">${escapeHtml((hero.lanes || []).join(" · "))}</span>
        </span>
      `;
      btn.addEventListener("click", () => selectHero(hero));
      els.heroGrid.appendChild(btn);
    });

    if (!filtered.length) {
      els.heroGrid.innerHTML = `<div class="notice compact">Tidak ada hero yang cocok dengan filter.</div>`;
    }
  }

  function startTimerRenderer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (!currentRoom || currentRoom.status !== "drafting" || !currentRoom.currentTurnStartedAt) return;
      const startedAt = currentRoom.currentTurnStartedAt.toDate ? currentRoom.currentTurnStartedAt.toDate().getTime() : Date.now();
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const remaining = Math.max(0, (currentRoom.turnSeconds || TURN_SECONDS) - elapsed);
      els.timerValue.textContent = `${remaining}s`;
    }, 500);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function copyRoomId() {
    if (!currentRoomId) return;
    await navigator.clipboard.writeText(currentRoomId);
    showToast("Room ID dicopy.");
  }

  async function copyResult() {
    if (!currentRoom) return;
    const result = [
      `HCI Draft Room - ${currentRoom.id}`,
      "",
      `Team A Ban: ${(currentRoom.bansA || []).map(heroLabel).join(", ") || "-"}`,
      `Team A Pick: ${(currentRoom.picksA || []).map(heroLabel).join(", ") || "-"}`,
      "",
      `Team B Ban: ${(currentRoom.bansB || []).map(heroLabel).join(", ") || "-"}`,
      `Team B Pick: ${(currentRoom.picksB || []).map(heroLabel).join(", ") || "-"}`
    ].join("\n");
    await navigator.clipboard.writeText(result);
    showToast("Result dicopy.");
  }

  function bindEvents() {
    els.createRoomBtn.addEventListener("click", createRoom);
    els.joinRoomBtn.addEventListener("click", joinRoom);
    els.roomIdInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") joinRoom();
    });
    els.copyRoomBtn.addEventListener("click", copyRoomId);
    els.startDraftBtn.addEventListener("click", startDraft);
    els.copyResultBtn.addEventListener("click", copyResult);
    els.deleteRoomBtn.addEventListener("click", deleteRoom);
    els.leaveRoomBtn.addEventListener("click", resetLocalState);
    els.heroSearch.addEventListener("input", renderHeroGrid);
    els.laneFilter.addEventListener("change", renderHeroGrid);
    document.querySelectorAll(".side-btn").forEach((btn) => btn.addEventListener("click", () => chooseSide(btn.dataset.side)));
  }

  bindEvents();
  renderHeroGrid();
  renderDraftSequence();
  initFirebase();
})();
