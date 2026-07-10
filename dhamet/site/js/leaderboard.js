(function () {
  "use strict";

  const Common = window.ZCommon || {};
  const sanitizeIconPath = function (p) {
    const rel = typeof Common.sanitizeUserIconPath === "function"
      ? Common.sanitizeUserIconPath(p)
      : "assets/icons/users/user1.png";
    return typeof Common.pageAssetUrl === "function" ? Common.pageAssetUrl(rel) : rel;
  };

  async function fetchLeaderboard(limit, currentUid) {
    if (!window.DhametAccount || typeof window.DhametAccount.getLeaderboard !== "function") return [];
    const res = await window.DhametAccount.getLeaderboard({ limit: limit || 200, currentUid: currentUid || "" });
    const rows = res && Array.isArray(res.rows) ? res.rows : [];
    return rows.filter((row) => Number(row.points) >= 1);
  }

  function selectLeaderboardRows(rows, currentUid) {
    // The official endpoint already returns ranked rows. Keep this selector as a
    // UI-level safety net only.
    const list = Array.isArray(rows) ? rows : [];
    return list.map((row, idx) => Object.assign({ rank: row.rank || idx + 1 }, row));
  }

  function buildLeaderboardBody(items) {
    const wrap = document.createElement("div");
    wrap.className = "z-leaderboard-wrap";

    const list = document.createElement("div");
    list.className = "z-leaderboard-list";

    if (!items || !items.length) {
      const empty = document.createElement("div");
      empty.className = "z-leaderboard-empty";
      empty.textContent = window.I18N.text("dashboard.leaderboard.empty");
      list.appendChild(empty);
      wrap.appendChild(list);
      return wrap;
    }

    items.forEach((it) => {
      if (it && it.separator) {
        const gap = document.createElement("div");
        gap.className = "z-leaderboard-row z-leaderboard-row-gap";
        gap.textContent = "…";
        list.appendChild(gap);
        return;
      }

      const row = document.createElement("div");
      row.className = "z-leaderboard-row";

      const left = document.createElement("div");
      left.className = "z-leaderboard-left";

      const rk = document.createElement("div");
      rk.className = "z-leaderboard-rank";
      rk.textContent = String(it.rank || "—");

      const img = document.createElement("img");
      img.className = "z-leaderboard-icon";
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      if (String(it.icon || "").trim()) {
        img.src = sanitizeIconPath(it.icon);
      } else {
        img.removeAttribute("src");
      }

      const name = document.createElement("div");
      name.className = "z-leaderboard-name";
      name.textContent = String(it.nickname || "");

      left.appendChild(rk);
      left.appendChild(img);
      left.appendChild(name);

      const right = document.createElement("div");
      right.className = "z-leaderboard-right";

      const pts = document.createElement("div");
      pts.className = "z-leaderboard-points";
      pts.textContent = String(it.points | 0);

      const wl = document.createElement("div");
      wl.className = "z-leaderboard-wl";
      wl.textContent = String((it.wins | 0) + "-" + (it.losses | 0));

      right.appendChild(pts);
      right.appendChild(wl);

      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    });

    wrap.appendChild(list);
    return wrap;
  }

  function openLeaderboardModal() {
    const body = document.createElement("div");
    body.className = "z-leaderboard-loading";
    body.textContent = window.I18N.text("status.loading");

    Modal.open({
      title: window.I18N.text("dashboard.leaderboard.title"),
      body,
      buttons: [
        {
          label: window.I18N.text("actions.ok"),
          className: "primary",
          onClick: function () {
            Modal.close();
          },
        },
      ],
    });

    (async () => {
      try {
        try {
          if (window.ZAuth && typeof ZAuth.initCloudflareAuth === "function") ZAuth.initCloudflareAuth();
        } catch (_) {}

        const session = window.ZAuth && typeof ZAuth.readSession === "function" ? ZAuth.readSession() : null;
        const currentUid = session && session.kind === "registered" ? String(session.uid || "") : "";

        const rows = await fetchLeaderboard(200, currentUid);
        const selectedRows = selectLeaderboardRows(rows, currentUid);
        const uids = selectedRows.filter((r) => r && !r.separator).map((r) => r.uid).filter(Boolean);

        const items = selectedRows.map((r) => {
          if (!r || r.separator) return { separator: true };
          return {
            uid: r.uid,
            rank: r.rank,
            points: r.points,
            wins: r.wins,
            losses: r.losses,
            nickname: r.nickname ? String(r.nickname) : "",
            icon: r.icon ? String(r.icon) : "",
          };
        });

        body.innerHTML = "";
        body.appendChild(buildLeaderboardBody(items));
      } catch (e) {
        body.textContent = window.I18N.text("dashboard.leaderboard.empty");
      }
    })();
  }

  function bindOpeners(root) {
    const scope = root || document;
    const bindOne = (trigger) => {
      if (!trigger || trigger.__zLeaderboardBound) return;
      trigger.addEventListener("click", function () {
        openLeaderboardModal();
      });
      trigger.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          openLeaderboardModal();
        }
      });
      trigger.__zLeaderboardBound = true;
    };
    Array.from(scope.querySelectorAll('[data-open-leaderboard="1"]')).forEach(bindOne);
  }

  window.ZLeaderboard = {
    openModal: openLeaderboardModal,
    bindOpeners: bindOpeners,
  };
})();
