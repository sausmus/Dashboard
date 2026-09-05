(() => {
  "use strict";

  const STORAGE_KEY = "teacherDashboard.sharedData.v1";
  const CHANGE_EVENT = "teacher-dashboard-data-changed";
  const LEGACY_TRACKER_KEY = "teacherDashboard_shared_v1";
  const LEGACY_MIGRATION_KEY = "teacherDashboard.participationLegacyMigration.v1";

  const PARTICIPATION_TERMS = [
    { id: "q1", label: "Quarter 1" },
    { id: "q2", label: "Quarter 2" },
    { id: "q3", label: "Quarter 3" },
    { id: "q4", label: "Quarter 4" },
    { id: "fall", label: "Fall Semester" },
    { id: "spring", label: "Spring Semester" }
  ];

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

  function createDefaultParticipationTerm(definition) {
    const scores = {};

    for (let i = 1; i <= 7; i += 1) {
      scores[String(i)] = {};
    }

    return {
      id: definition.id,
      label: definition.label,
      goal: 5,
      scores
    };
  }

  function createDefaultParticipation() {
    const terms = {};

    PARTICIPATION_TERMS.forEach(definition => {
      terms[definition.id] = createDefaultParticipationTerm(definition);
    });

    return {
      activeTermId: "q1",
      terms
    };
  }

  function createDefaultData() {
    return {
      version: 2,
      classes: createDefaultClasses(),
      currentClassId: "1",
      participation: createDefaultParticipation()
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeStudentName(value) {
    return String(value ?? "").trim().replace(/\s+/g, " ");
  }

  function participationNameKey(value) {
    return normalizeStudentName(value).toLocaleLowerCase();
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

  function clampGoal(value) {
    return Math.max(1, Math.min(20, Math.floor(Number(value) || 5)));
  }

  function clampPoints(value) {
    return Math.max(0, Math.min(999, Math.floor(Number(value) || 0)));
  }

  function normalizeParticipation(raw) {
    const defaults = createDefaultParticipation();
    const incoming = raw && typeof raw === "object" ? raw : {};
    const activeCandidate = String(
      incoming.activeTermId ?? incoming.activeTerm ?? defaults.activeTermId
    );

    const participation = {
      activeTermId: PARTICIPATION_TERMS.some(term => term.id === activeCandidate)
        ? activeCandidate
        : defaults.activeTermId,
      terms: {}
    };

    PARTICIPATION_TERMS.forEach(definition => {
      const incomingTerm = incoming.terms?.[definition.id] ?? {};
      const normalizedTerm = createDefaultParticipationTerm(definition);

      normalizedTerm.label =
        String(incomingTerm.label ?? definition.label).trim() || definition.label;
      normalizedTerm.goal = clampGoal(incomingTerm.goal);

      for (let i = 1; i <= 7; i += 1) {
        const classId = String(i);
        const incomingScores =
          incomingTerm.scores?.[classId] ?? incomingTerm.periods?.[classId] ?? {};

        if (!incomingScores || typeof incomingScores !== "object") continue;

        Object.entries(incomingScores).forEach(([rawKey, rawRecord]) => {
          let name = "";
          let points = 0;
          let updatedAt = "";

          if (rawRecord && typeof rawRecord === "object") {
            name = normalizeStudentName(rawRecord.name ?? "");
            points = clampPoints(rawRecord.points);
            updatedAt = String(rawRecord.updatedAt ?? "");
          } else {
            points = clampPoints(rawRecord);
          }

          if (!name && rawKey && !/^student[-_]/i.test(rawKey)) {
            name = normalizeStudentName(rawKey);
          }

          if (!name) return;

          const key = participationNameKey(name);
          normalizedTerm.scores[classId][key] = {
            name,
            points,
            updatedAt
          };
        });
      }

      participation.terms[definition.id] = normalizedTerm;
    });

    return participation;
  }

  function normalizeData(raw) {
    const defaults = createDefaultData();

    if (!raw || typeof raw !== "object") {
      return defaults;
    }

    const data = {
      version: 2,
      classes: {},
      currentClassId: String(raw.currentClassId ?? defaults.currentClassId),
      participation: normalizeParticipation(raw.participation)
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

    if (!data.classes[data.currentClassId] || !data.classes[data.currentClassId].active) {
      const firstActive = Object.values(data.classes).find(item => item.active);
      data.currentClassId = firstActive?.id ?? "1";
    }

    return data;
  }

  function hasAnyParticipationScores(data) {
    return PARTICIPATION_TERMS.some(definition =>
      Object.values(data.participation.terms[definition.id].scores).some(classScores =>
        Object.values(classScores).some(record => clampPoints(record?.points) > 0)
      )
    );
  }

  function migrateLegacyTrackerData(data) {
    if (localStorage.getItem(LEGACY_MIGRATION_KEY) === "true") {
      return { data, changed: false };
    }

    let legacy;

    try {
      const raw = localStorage.getItem(LEGACY_TRACKER_KEY);
      legacy = raw ? JSON.parse(raw) : null;
    } catch (error) {
      console.warn("Legacy Participation Tracker data could not be read.", error);
      localStorage.setItem(LEGACY_MIGRATION_KEY, "true");
      return { data, changed: false };
    }

    if (!legacy || typeof legacy !== "object") {
      localStorage.setItem(LEGACY_MIGRATION_KEY, "true");
      return { data, changed: false };
    }

    let changed = false;
    const officialHadScores = hasAnyParticipationScores(data);

    for (let i = 1; i <= 7; i += 1) {
      const classId = String(i);
      const legacyRoster = Array.isArray(legacy.rosters?.[classId])
        ? legacy.rosters[classId]
        : [];

      if (data.classes[classId].students.length === 0 && legacyRoster.length > 0) {
        data.classes[classId].students = normalizeStudents(
          legacyRoster.map(student =>
            student && typeof student === "object" ? student.name : student
          )
        );
        changed = true;
      }
    }

    const legacyActive = String(legacy.participation?.activeTerm ?? "");

    if (
      !officialHadScores &&
      PARTICIPATION_TERMS.some(term => term.id === legacyActive)
    ) {
      data.participation.activeTermId = legacyActive;
      changed = true;
    }

    PARTICIPATION_TERMS.forEach(definition => {
      const legacyTerm = legacy.participation?.terms?.[definition.id];

      if (!legacyTerm || typeof legacyTerm !== "object") return;

      if (!officialHadScores && Number.isFinite(Number(legacyTerm.goal))) {
        data.participation.terms[definition.id].goal = clampGoal(legacyTerm.goal);
        changed = true;
      }

      for (let i = 1; i <= 7; i += 1) {
        const classId = String(i);
        const legacyRoster = Array.isArray(legacy.rosters?.[classId])
          ? legacy.rosters[classId]
          : [];
        const namesById = new Map();

        legacyRoster.forEach(student => {
          if (!student || typeof student !== "object") return;

          const id = String(student.id ?? "");
          const name = normalizeStudentName(student.name);

          if (id && name) namesById.set(id, name);
        });

        const legacyScores = legacyTerm.periods?.[classId];

        if (!legacyScores || typeof legacyScores !== "object") continue;

        Object.entries(legacyScores).forEach(([studentId, rawRecord]) => {
          const name = namesById.get(String(studentId));

          if (!name) return;

          const points = clampPoints(
            rawRecord && typeof rawRecord === "object"
              ? rawRecord.points
              : rawRecord
          );

          if (points <= 0) return;

          const key = participationNameKey(name);

          const officialRecord =
            data.participation.terms[definition.id].scores[classId][key];

          if (!officialRecord || clampPoints(officialRecord.points) === 0) {
            data.participation.terms[definition.id].scores[classId][key] = {
              name,
              points,
              updatedAt:
                rawRecord && typeof rawRecord === "object"
                  ? String(rawRecord.updatedAt ?? "")
                  : ""
            };

            changed = true;
          }
        });
      }
    });

    localStorage.setItem(LEGACY_MIGRATION_KEY, "true");

    return { data, changed };
  }

  function load() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);

      let data = saved
        ? normalizeData(JSON.parse(saved))
        : createDefaultData();

      const migration = migrateLegacyTrackerData(data);

      data = normalizeData(migration.data);

      if (!saved || migration.changed) {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(data)
        );
      }

      return clone(data);

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
      new CustomEvent(CHANGE_EVENT, {
        detail: {
          data: clone(normalized),
          ...detail
        }
      })
    );

    return clone(normalized);
  }

  function getClasses(options = {}) {
    const { activeOnly = false } = options;
    const classes = Object.values(load().classes);

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
      throw new Error(`Unknown class id: ${id}`);
    }

    if (Object.prototype.hasOwnProperty.call(updates, "name")) {
      const name = String(updates.name ?? "").trim();

      data.classes[id].name =
        name || `Period ${id}`;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "active")) {
      data.classes[id].active =
        Boolean(updates.active);
    }

    if (Object.prototype.hasOwnProperty.call(updates, "students")) {
      data.classes[id].students =
        normalizeStudents(updates.students);
    }

    return save(data, {
      type: "class-updated",
      classId: id
    });
  }

  function setClassActive(classId, active) {
    return updateClass(classId, { active });
  }

  function getRoster(classId) {
    return getClass(classId)?.students ?? [];
  }

  function saveRoster(classId, students) {
    const id = String(classId);
    const data = load();

    if (!data.classes[id]) {
      throw new Error(`Unknown class id: ${id}`);
    }

    data.classes[id].students =
      normalizeStudents(students);

    return save(data, {
      type: "roster-updated",
      classId: id
    });
  }

  function getCurrentClassId() {
    return load().currentClassId;
  }

  function getCurrentClass() {
    const data = load();

    return clone(
      data.classes[data.currentClassId] ?? null
    );
  }

  function setCurrentClass(classId) {
    const id = String(classId);
    const data = load();

    if (!data.classes[id]) {
      throw new Error(`Unknown class id: ${id}`);
    }

    if (!data.classes[id].active) {
      throw new Error(
        `Class ${id} is hidden and cannot be the current class.`
      );
    }

    data.currentClassId = id;

    return save(data, {
      type: "current-class-changed",
      classId: id
    });
  }

  function getParticipationTerms() {
    const data = load();

    return PARTICIPATION_TERMS.map(definition => ({
      id: definition.id,
      label: data.participation.terms[definition.id].label,
      goal: data.participation.terms[definition.id].goal
    }));
  }

  function getActiveParticipationTermId() {
    return load().participation.activeTermId;
  }

  function setActiveParticipationTerm(termId) {
    const id = String(termId);
    const data = load();

    if (!data.participation.terms[id]) {
      throw new Error(
        `Unknown participation term: ${id}`
      );
    }

    data.participation.activeTermId = id;

    return save(data, {
      type: "participation-term-changed",
      termId: id
    });
  }

  function getParticipationGoal(
    termId = getActiveParticipationTermId()
  ) {
    const id = String(termId);
    const data = load();

    return data.participation.terms[id]?.goal ?? 5;
  }

  function setParticipationGoal(termId, goal) {
    const id = String(termId);
    const data = load();

    if (!data.participation.terms[id]) {
      throw new Error(
        `Unknown participation term: ${id}`
      );
    }

    data.participation.terms[id].goal =
      clampGoal(goal);

    return save(data, {
      type: "participation-goal-changed",
      termId: id,
      goal: data.participation.terms[id].goal
    });
  }

  function getParticipationPoints(
    classId,
    studentName,
    termId = getActiveParticipationTermId()
  ) {
    const classKey = String(classId);
    const termKey = String(termId);
    const nameKey =
      participationNameKey(studentName);

    if (!nameKey) return 0;

    const data = load();

    return clampPoints(
      data.participation
        .terms[termKey]
        ?.scores?.[classKey]
        ?.[nameKey]
        ?.points
    );
  }

  function setParticipationPoints(
    classId,
    studentName,
    points,
    termId = getActiveParticipationTermId()
  ) {
    const classKey = String(classId);
    const termKey = String(termId);
    const name = normalizeStudentName(studentName);
    const nameKey = participationNameKey(name);
    const data = load();

    if (!data.classes[classKey]) {
      throw new Error(
        `Unknown class id: ${classKey}`
      );
    }

    if (!data.participation.terms[termKey]) {
      throw new Error(
        `Unknown participation term: ${termKey}`
      );
    }

    if (!nameKey) {
      throw new Error(
        "Student name is required."
      );
    }

    const nextPoints =
      clampPoints(points);

    const classScores =
      data.participation
        .terms[termKey]
        .scores[classKey];

    if (nextPoints === 0) {
      delete classScores[nameKey];
    } else {
      classScores[nameKey] = {
        name,
        points: nextPoints,
        updatedAt: new Date().toISOString()
      };
    }

    save(data, {
      type: "participation-points-changed",
      classId: classKey,
      termId: termKey,
      studentName: name,
      points: nextPoints
    });

    return nextPoints;
  }

  function adjustParticipationPoints(
    classId,
    studentName,
    delta = 1,
    termId = getActiveParticipationTermId()
  ) {
    const previous =
      getParticipationPoints(
        classId,
        studentName,
        termId
      );

    return setParticipationPoints(
      classId,
      studentName,
      previous + Number(delta || 0),
      termId
    );
  }

  function getParticipationForClass(
    classId,
    termId = getActiveParticipationTermId()
  ) {
    const id = String(classId);
    const termKey = String(termId);
    const data = load();

    const roster =
      data.classes[id]?.students ?? [];

    const term =
      data.participation.terms[termKey];

    if (!term) {
      throw new Error(
        `Unknown participation term: ${termKey}`
      );
    }

    return roster.map(name => ({
      name,

      points: clampPoints(
        term.scores[id]
          ?.[participationNameKey(name)]
          ?.points
      ),

      goal: term.goal,

      complete:
        clampPoints(
          term.scores[id]
            ?.[participationNameKey(name)]
            ?.points
        ) >= term.goal
    }));
  }

  function resetSharedData() {
    const defaults =
      createDefaultData();

    return save(defaults, {
      type: "reset"
    });
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
      JSON.parse(String(jsonText));

    return save(parsed, {
      type: "import"
    });
  }

  window.addEventListener(
    "storage",
    event => {
      if (event.key !== STORAGE_KEY) {
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
      participationTerms:
        clone(PARTICIPATION_TERMS),

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

      getParticipationTerms,
      getActiveParticipationTermId,
      setActiveParticipationTerm,
      getParticipationGoal,
      setParticipationGoal,
      getParticipationPoints,
      setParticipationPoints,
      adjustParticipationPoints,
      getParticipationForClass,

      resetSharedData,
      exportSharedData,
      importSharedData
    });
})();
