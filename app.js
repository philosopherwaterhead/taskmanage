let db;
let currentTab = "inprogress";

const request = indexedDB.open("TaskDB", 1);

request.onupgradeneeded = e => {
  db = e.target.result;
  if (!db.objectStoreNames.contains("tasks")) {
    db.createObjectStore("tasks", { keyPath: "id", autoIncrement: true });
  }
};

request.onsuccess = e => {
  db = e.target.result;
  switchTab("inprogress");
};

request.onerror = e => {
  console.error("DB open error:", e);
};

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tabs button").forEach(b => b.classList.remove("active"));
  const activeBtn = document.getElementById("tab-" + tab);
  if (activeBtn) activeBtn.classList.add("active");
  renderTasks();
}

function openForm(task = null) {
  document.getElementById("modal").classList.remove("hidden");

  if (task) {
    document.getElementById("taskId").value = task.id;
    document.getElementById("title").value = task.title;
    document.querySelector(`input[name="type"][value="${task.type}"]`).checked = true;
    document.querySelector(`input[name="genre"][value="${task.genre}"]`).checked = true;
    document.getElementById("status").value = task.status;
  }
}

function closeForm() {
  document.getElementById("taskForm").reset();
  document.getElementById("taskId").value = "";
  document.getElementById("modal").classList.add("hidden");
}

document.getElementById("taskForm").addEventListener("submit", e => {
  e.preventDefault();

  const id = document.getElementById("taskId").value;
  const titleValue = document.getElementById("title").value;
  const typeValue = document.querySelector("input[name='type']:checked").value;
  const genreValue = document.querySelector("input[name='genre']:checked").value;
  const statusValue = document.getElementById("status").value;

  const task = {
    title: titleValue,
    type: typeValue,
    genre: genreValue,
    status: statusValue
  };

  const tx = db.transaction("tasks", "readwrite");
  const store = tx.objectStore("tasks");

  if (id) {
    task.id = Number(id);
    store.put(task);
  } else {
    store.add(task);
  }

  tx.oncomplete = () => {
    closeForm();
    renderTasks();
  };

  tx.onerror = err => {
    console.error("Transaction error:", err);
  };
});

function deleteTask(id) {
  const tx = db.transaction("tasks", "readwrite");
  tx.objectStore("tasks").delete(id);
  tx.oncomplete = renderTasks;
}

function renderTasks() {
  if (!db) return;

  const tx = db.transaction("tasks", "readonly");
  const store = tx.objectStore("tasks");
  const request = store.getAll();

  request.onsuccess = () => {
    let tasks = request.result.filter(t => t.status === currentTab);

    const sortMode = document.getElementById("sortMode").value;

    tasks.sort((a, b) => {
      if (sortMode === "type") {
        return a.type.localeCompare(b.type);
      } else {
        return a.genre.localeCompare(b.genre);
      }
    });

    const container = document.getElementById("taskContainer");
    container.innerHTML = "";

    tasks.forEach(task => {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <h3>${task.title}</h3>
        <div>${task.type} / ${task.genre}</div>
        <div class="card-buttons">
          <button class="edit-btn">編集</button>
          <button class="delete-btn">削除</button>
        </div>
      `;

      card.querySelector(".edit-btn").onclick = () => openForm(task);
      card.querySelector(".delete-btn").onclick = () => deleteTask(task.id);

      container.appendChild(card);
    });
  };
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}
