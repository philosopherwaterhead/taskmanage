const API_URL = "/api/tasks";
const DB_NAME = "TaskDB";
const DB_VERSION = 2;

let db = null;
let currentTab = "inprogress";
let syncing = false;

/* =========================================================
   IndexedDB
========================================================= */

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const database = event.target.result;

      // 既存のtasksストアはそのまま利用する
      if (!database.objectStoreNames.contains("tasks")) {
        database.createObjectStore("tasks", {
          keyPath: "id",
          autoIncrement: true
        });
      }

      // APIキーや同期状態を保存する
      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings", {
          keyPath: "key"
        });
      }
    };

    request.onsuccess = event => {
      resolve(event.target.result);
    };

    request.onerror = event => {
      reject(event.target.error);
    };
  });
}

function getAllTasksFromCache() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tasks", "readonly");
    const request = tx.objectStore("tasks").getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function replaceTaskCache(tasks) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tasks", "readwrite");
    const store = tx.objectStore("tasks");

    store.clear();

    for (const task of tasks) {
      store.put({
        id: String(task.id),
        title: task.title,
        type: task.type,
        genre: task.genre,
        status: task.status,
        sort_order_type:
          Number(task.sort_order_type ?? 0),
        sort_order_genre:
          Number(task.sort_order_genre ?? 0),
        created_at: task.created_at,
        updated_at: task.updated_at
      });
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getSetting(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readonly");
    const request = tx.objectStore("settings").get(key);

    request.onsuccess = () => {
      resolve(request.result?.value ?? null);
    };

    request.onerror = () => reject(request.error);
  });
}

function setSetting(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readwrite");

    tx.objectStore("settings").put({
      key,
      value
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* =========================================================
   API
========================================================= */

async function getApiKey() {
  return getSetting("apiKey");
}

async function apiRequest(path = "", options = {}) {
  const apiKey = await getApiKey();

  if (!apiKey) {
    throw new Error("API_KEY_NOT_SET");
  }

  const headers = new Headers(options.headers ?? {});

  headers.set("Accept", "application/json");
  headers.set("X-API-Key", apiKey);

  if (options.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    cache: "no-store"
  });

  let body = null;

  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("API_KEY_INVALID");
    }

    throw new Error(
      body?.error ??
      `通信に失敗しました（HTTP ${response.status}）`
    );
  }

  return body;
}

function fetchCloudTasks() {
  return apiRequest();
}

function createCloudTask(task) {
  return apiRequest("", {
    method: "POST",
    body: JSON.stringify(task)
  });
}

function updateCloudTask(id, task) {
  return apiRequest(`/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(task)
  });
}

function deleteCloudTask(id) {
  return apiRequest(`/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

function reorderCloudTasks({
  status,
  mode,
  group,
  ids
}) {
  return apiRequest("/reorder", {
    method: "PUT",
    body: JSON.stringify({
      status,
      mode,
      group,
      ids
    })
  });
}

/* =========================================================
   初回移行
========================================================= */

async function migrateExistingIndexedDbTasks() {
  const migrationCompleted =
    await getSetting("cloudMigrationCompleted");

  if (migrationCompleted) {
    return;
  }

  const localTasks = await getAllTasksFromCache();

  // D1側にすでに存在するタスクを調べる
  const cloudTasks = await fetchCloudTasks();
  const cloudIds = new Set(
    cloudTasks.map(task => String(task.id))
  );

  for (const task of localTasks) {
    /*
      旧IndexedDBの数値IDとD1側のIDが衝突しないよう、
      legacy- を付ける。
    */
    const migrationId = `legacy-${task.id}`;

    if (cloudIds.has(migrationId)) {
      continue;
    }

    await createCloudTask({
      id: migrationId,
      title: task.title,
      type: task.type,
      genre: task.genre,
      status: task.status
    });
  }

  await setSetting("cloudMigrationCompleted", true);
}

/* =========================================================
   同期
========================================================= */

async function syncTasks({
  migrate = true,
  showMessage = true
} = {}) {
  if (syncing) {
    return;
  }

  const apiKey = await getApiKey();

  if (!apiKey) {
    openSettings();
    return;
  }

  syncing = true;
  setSyncStatus("同期中…");

  try {
    if (migrate) {
      await migrateExistingIndexedDbTasks();
    }

    const cloudTasks = await fetchCloudTasks();

    await replaceTaskCache(cloudTasks);
    await renderTasks();

    const now = new Date().toLocaleString("ja-JP");

    setSyncStatus(`最終同期: ${now}`);

    if (showMessage) {
      console.log("同期が完了しました");
    }
  } catch (error) {
    console.error("Sync failed:", error);

    if (error.message === "API_KEY_INVALID") {
      setSyncStatus("APIキーが正しくありません");
      openSettings();
    } else {
      setSyncStatus("同期失敗・端末内データを表示中");
    }

    // 通信に失敗してもキャッシュを表示する
    await renderTasks();
  } finally {
    syncing = false;
  }
}

function setSyncStatus(message) {
  const element = document.getElementById("syncStatus");

  if (element) {
    element.textContent = message;
  }
}

/* =========================================================
   タスク画面
========================================================= */

function switchTab(tab) {
  currentTab = tab;

  document
    .querySelectorAll(".tabs button")
    .forEach(button => button.classList.remove("active"));

  document
    .getElementById(`tab-${tab}`)
    ?.classList.add("active");

  renderTasks();
}

function openForm(task = null) {
  document
    .getElementById("modal")
    .classList.remove("hidden");

  if (!task) {
    return;
  }

  document.getElementById("taskId").value = task.id;
  document.getElementById("title").value = task.title;

  const typeInput = document.querySelector(
    `input[name="type"][value="${CSS.escape(task.type)}"]`
  );

  const genreInput = document.querySelector(
    `input[name="genre"][value="${CSS.escape(task.genre)}"]`
  );

  if (typeInput) {
    typeInput.checked = true;
  }

  if (genreInput) {
    genreInput.checked = true;
  }

  document.getElementById("status").value = task.status;
}

function closeForm() {
  document.getElementById("taskForm").reset();
  document.getElementById("taskId").value = "";

  document
    .getElementById("modal")
    .classList.add("hidden");
}

async function saveTask(event) {
  event.preventDefault();

  const submitButton =
    event.currentTarget.querySelector(
      'button[type="submit"]'
    );

  submitButton.disabled = true;

  const id = document.getElementById("taskId").value;

  const task = {
    title: document.getElementById("title").value.trim(),
    type: document.querySelector(
      "input[name='type']:checked"
    ).value,
    genre: document.querySelector(
      "input[name='genre']:checked"
    ).value,
    status: document.getElementById("status").value
  };

  try {
    if (id) {
      await updateCloudTask(id, task);
    } else {
      await createCloudTask(task);
    }

    closeForm();

    await syncTasks({
      migrate: false,
      showMessage: false
    });
  } catch (error) {
    console.error("Task save failed:", error);

    if (error.message === "API_KEY_NOT_SET") {
      openSettings();
      return;
    }

    if (error.message === "API_KEY_INVALID") {
      alert("APIキーが正しくありません。");
      openSettings();
      return;
    }

    alert(`保存できませんでした。\n${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
}

async function deleteTask(id) {
  const confirmed = confirm(
    "このタスクを削除しますか？"
  );

  if (!confirmed) {
    return;
  }

  try {
    await deleteCloudTask(id);

    await syncTasks({
      migrate: false,
      showMessage: false
    });
  } catch (error) {
    console.error("Task deletion failed:", error);

    if (error.message === "API_KEY_INVALID") {
      alert("APIキーが正しくありません。");
      openSettings();
      return;
    }

    alert(`削除できませんでした。\n${error.message}`);
  }
}

async function renderTasks() {
  if (!db) {
    return;
  }

  const allTasks =
    await getAllTasksFromCache();

  const container =
    document.getElementById(
      "taskContainer"
    );

  container.innerHTML = "";

  const tasks = allTasks.filter(
    task => task.status === currentTab
  );

  const sortMode =
    document.getElementById(
      "sortMode"
    ).value;

  let groups;

  if (sortMode === "type") {
    groups = {
      "編集": [],
      "執筆": []
    };

    for (const task of tasks) {
      groups[task.type]?.push(task);
    }
  } else {
    groups = {
      "動画": [],
      "物語": []
    };

    for (const task of tasks) {
      groups[task.genre]?.push(task);
    }
  }

  /*
   * 現在の表示方式に対応した
   * 並び順を使用する。
   */
  const orderField =
    sortMode === "type"
      ? "sort_order_type"
      : "sort_order_genre";

  let visibleTaskCount = 0;

  for (
    const [groupName, groupTasks]
    of Object.entries(groups)
  ) {
    if (groupTasks.length === 0) {
      continue;
    }

    groupTasks.sort((a, b) => {
      const orderDifference =
        Number(a[orderField] ?? 0) -
        Number(b[orderField] ?? 0);

      if (orderDifference !== 0) {
        return orderDifference;
      }

      return (
        Number(a.created_at ?? 0) -
        Number(b.created_at ?? 0)
      );
    });

    visibleTaskCount +=
      groupTasks.length;

    const header =
      document.createElement("h2");

    header.className = "group-header";
    header.textContent = groupName;

    container.appendChild(header);

    /*
     * グループごとに専用のリストを作る。
     * SortableJSはこの要素内だけで動く。
     */
    const groupList =
      document.createElement("div");

    groupList.className =
      "sortable-task-list";

    groupList.dataset.mode = sortMode;
    groupList.dataset.group = groupName;
    groupList.dataset.status = currentTab;

    container.appendChild(groupList);

    for (const task of groupTasks) {
      const card =
        document.createElement("div");

      card.className = "card";
      card.dataset.taskId =
        String(task.id);

      const dragHandle =
        document.createElement("div");

      dragHandle.className =
        "drag-handle";

      dragHandle.textContent = "☰";
      dragHandle.setAttribute(
        "aria-label",
        "長押しして並べ替え"
      );

      const title =
        document.createElement("h3");

      title.textContent = task.title;

      const metadata =
        document.createElement("div");

      metadata.className =
        "card-metadata";

      metadata.textContent =
        `${task.type} / ${task.genre}`;

      const buttons =
        document.createElement("div");

      buttons.className =
        "card-buttons";

      const editButton =
        document.createElement("button");

      editButton.type = "button";
      editButton.className = "edit-btn";
      editButton.textContent = "編集";

      editButton.addEventListener(
        "click",
        () => openForm(task)
      );

      const deleteButton =
        document.createElement("button");

      deleteButton.type = "button";
      deleteButton.className =
        "delete-btn";

      deleteButton.textContent = "削除";

      deleteButton.addEventListener(
        "click",
        () => deleteTask(task.id)
      );

      buttons.append(
        editButton,
        deleteButton
      );

      card.append(
        dragHandle,
        title,
        metadata,
        buttons
      );

      groupList.appendChild(card);
    }

    /*
     * 同じグループ内だけ並べ替え可能。
     * groupオプションを指定していないため、
     * 編集→執筆などの越境はできない。
     */
    new Sortable(groupList, {
      animation: 150,

      handle: ".drag-handle",

      ghostClass: "sortable-ghost",

      chosenClass: "sortable-chosen",

      dragClass: "sortable-drag",

      /*
       * スマートフォンでは少し長押ししてから
       * ドラッグを開始する。
       */
      delay: 180,
      delayOnTouchOnly: true,
      touchStartThreshold: 4,

      onStart() {
        document.body.classList.add(
          "is-sorting"
        );
      },

      async onEnd() {
        document.body.classList.remove(
          "is-sorting"
        );

        const ids = Array
          .from(
            groupList.querySelectorAll(
              ".card"
            )
          )
          .map(card =>
            card.dataset.taskId
          )
          .filter(Boolean);

        setSyncStatus(
          "並び順を保存中…"
        );

        try {
          await reorderCloudTasks({
            status:
              groupList.dataset.status,
            mode:
              groupList.dataset.mode,
            group:
              groupList.dataset.group,
            ids
          });

          /*
           * サーバーから改めて取得し、
           * IndexedDBも新順序へ更新する。
           */
          await syncTasks({
            migrate: false,
            showMessage: false
          });
        } catch (error) {
          console.error(
            "Task reorder failed:",
            error
          );

          alert(
            `並び順を保存できませんでした。\n${error.message}`
          );

          /*
           * 保存失敗時はサーバー上の順番を
           * 再取得して表示を戻す。
           */
          await syncTasks({
            migrate: false,
            showMessage: false
          });
        }
      }
    });
  }

  if (visibleTaskCount === 0) {
    const emptyMessage =
      document.createElement("p");

    emptyMessage.textContent =
      "タスクはありません。";

    container.appendChild(
      emptyMessage
    );
  }
}

/* =========================================================
   設定画面
========================================================= */

async function openSettings() {
  const currentKey = await getApiKey();

  document.getElementById("apiKeyInput").value =
    currentKey ?? "";

  document
    .getElementById("settingsModal")
    .classList.remove("hidden");
}

function closeSettings() {
  document
    .getElementById("settingsModal")
    .classList.add("hidden");
}

async function saveSettings(event) {
  event.preventDefault();

  const apiKey =
    document.getElementById("apiKeyInput")
      .value
      .trim();

  if (!apiKey) {
    return;
  }

  await setSetting("apiKey", apiKey);
  closeSettings();

  await syncTasks();
}

/* =========================================================
   初期化
========================================================= */

async function initializeApp() {
  try {
    db = await openDatabase();

    // まず端末内キャッシュを表示
    switchTab("inprogress");

    const apiKey = await getApiKey();

    if (apiKey) {
      // 裏でD1と同期
      await syncTasks();
    } else {
      setSyncStatus("設定からAPIキーを登録してください");
      openSettings();
    }
  } catch (error) {
    console.error("Application initialization failed:", error);
    setSyncStatus("アプリの初期化に失敗しました");
  }
}

/* =========================================================
   イベント
========================================================= */

document
  .getElementById("tab-inprogress")
  .addEventListener(
    "click",
    () => switchTab("inprogress")
  );

document
  .getElementById("tab-preparing")
  .addEventListener(
    "click",
    () => switchTab("preparing")
  );

document
  .getElementById("sortMode")
  .addEventListener("change", renderTasks);

document
  .getElementById("openFormButton")
  .addEventListener("click", () => openForm());

document
  .getElementById("cancelTaskButton")
  .addEventListener("click", closeForm);

document
  .getElementById("taskForm")
  .addEventListener("submit", saveTask);

document
  .getElementById("syncButton")
  .addEventListener("click", () => syncTasks());

document
  .getElementById("settingsButton")
  .addEventListener("click", openSettings);

document
  .getElementById("cancelSettingsButton")
  .addEventListener("click", closeSettings);

document
  .getElementById("settingsForm")
  .addEventListener("submit", saveSettings);

initializeApp();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .catch(error => {
      console.error(
        "Service worker registration failed:",
        error
      );
    });
}
