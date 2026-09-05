(() => {
  "use strict";

  const STORAGE_KEY = "teacherDashboard.sharedData.v1";
  const CHANGE_EVENT = "teacher-dashboard-data-changed";

  function createDefaultClasses() {
    const classes = {};

    for (let i = 1; i <= 7; i += 1) {
      classes[String(i)] = {
        id: String(i),
        name: `Period ${i}`,
        active: true,
        students: []
      };
    }

    return classes;
  }

  function createDefaultData() {
    return {
      version: 1,
      classes: createDefaultClasses(),
      currentClassId: "1"
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeStudentName(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ");
  }

  function normalizeStudents(students) {
    if (!Array.isArray(students)) return [];

    const seen = new Set();
    const cleaned = [];

    for (const item of students) {
      const name = normalizeStudentName(item);
      if (!name) continue;

      const key = name.toLocaleLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      cleaned.push(name);
    }

    return cleaned;
  }

  function normalizeData(raw) {
    const defaults = createDefaultData();

    if (!raw || typeof raw !== "object") {
      return defaults;
    }

    const data = {
      version: 1,
      classes: {},
      currentClassId: String(raw.currentClassId ?? defaults.currentClassId)
    };

    for (let i = 1; i <= 7; i += 1) {
      const id = String(i);
      const incoming = raw.classes?.[id] ?? {};

      data.classes[id] = {
        id,
        name: String(incoming.name ?? `Period ${i}`).trim() || `Period ${i}`,
        active: incoming.active !== false,
        students: normalizeStudents(incoming.students)
      };
    }

    if (
      !data.classes[data.currentClassId] ||
      !data.classes[data.currentClassId].active
    ) {
      const firstActive = Object.values(data.classes).find(
        item => item.active
      );

      data.currentClassId = firstActive?.id ?? "1";
    }

    return data;
  }

  function load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);

      if (!saved) {
        const defaults = createDefaultData();

        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(defaults)
        );

        return clone(defaults);
      }

      return clone(
        normalizeData(
          JSON.parse(saved)
        )
      );
    } catch (error) {
      console.warn(
        "Teacher Dashboard shared data could not be loaded.",
        error
      );

      return createDefaultData();
    }
  }

  function save(data, detail = {}) {
    const normalized = normalizeData(data);

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(normalized)
      );
    } catch (error) {
      console.error(
        "Teacher Dashboard shared data could not be saved.",
        error
      );

      throw error;
    }

    window.dispatchEvent(
      new CustomEvent(
        CHANGE_EVENT,
        {
          detail: {
            data: clone(normalized),
            ...detail
          }
        }
      )
    );

    return clone(normalized);
  }

  function getClasses(options = {}) {
    const {
      activeOnly = false
    } = options;

    const classes = Object.values(
      load().classes
    );

    return clone(
      activeOnly
        ? classes.filter(item => item.active)
        : classes
    );
  }

  function getClass(classId) {
    const id = String(classId);

    return clone(
      load().classes[id] ?? null
    );
  }

  function updateClass(classId, updates = {}) {
    const id = String(classId);
    const data = load();

    if (!data.classes[id]) {
      throw new Error(
        `Unknown class id: ${id}`
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        updates,
        "name"
      )
    ) {
      const name = String(
        updates.name ?? ""
      ).trim();

      data.classes[id].name =
        name || `Period ${id}`;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        updates,
        "active"
      )
    ) {
      data.classes[id].active =
        Boolean(updates.active);
    }

    if (
      Object.prototype.hasOwnProperty.call(
        updates,
        "students"
      )
    ) {
      data.classes[id].students =
        normalizeStudents(
          updates.students
        );
    }

    return save(
      data,
      {
        type: "class-updated",
        classId: id
      }
    );
  }

  function setClassActive(classId, active) {
    return updateClass(
      classId,
      {
        active
      }
    );
  }

  function getRoster(classId) {
    return (
      getClass(classId)?.students ?? []
    );
  }

  function saveRoster(classId, students) {
    const id = String(classId);
    const data = load();

    if (!data.classes[id]) {
      throw new Error(
        `Unknown class id: ${id}`
      );
    }

    data.classes[id].students =
      normalizeStudents(students);

    return save(
      data,
      {
        type: "roster-updated",
        classId: id
      }
    );
  }

  function getCurrentClassId() {
    return load().currentClassId;
  }

  function getCurrentClass() {
    const data = load();

    return clone(
      data.classes[
        data.currentClassId
      ] ?? null
    );
  }

  function setCurrentClass(classId) {
    const id = String(classId);
    const data = load();

    if (!data.classes[id]) {
      throw new Error(
        `Unknown class id: ${id}`
      );
    }

    if (!data.classes[id].active) {
      throw new Error(
        `Class ${id} is hidden and cannot be the current class.`
      );
    }

    data.currentClassId = id;

    return save(
      data,
      {
        type: "current-class-changed",
        classId: id
      }
    );
  }

  function resetSharedData() {
    const defaults =
      createDefaultData();

    return save(
      defaults,
      {
        type: "reset"
      }
    );
  }

  function exportSharedData() {
    return JSON.stringify(
      load(),
      null,
      2
    );
  }

  function importSharedData(jsonText) {
    const parsed =
      JSON.parse(
        String(jsonText)
      );

    return save(
      parsed,
      {
        type: "import"
      }
    );
  }

  window.addEventListener(
    "storage",
    event => {
      if (
        event.key !== STORAGE_KEY
      ) {
        return;
      }

      window.dispatchEvent(
        new CustomEvent(
          CHANGE_EVENT,
          {
            detail: {
              type: "external-storage-change",
              data: load()
            }
          }
        )
      );
    }
  );

  window.DashboardData =
    Object.freeze({
      storageKey: STORAGE_KEY,
      changeEvent: CHANGE_EVENT,

      load,
      save,

      getClasses,
      getClass,
      updateClass,
      setClassActive,

      getRoster,
      saveRoster,

      getCurrentClassId,
      getCurrentClass,
      setCurrentClass,

      resetSharedData,
      exportSharedData,
      importSharedData
    });
})();
