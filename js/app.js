/* app.js: everything the student sees and touches.
   Builds the form, reads the answers, asks model.js for a score and shows the result. */
(function () {
  "use strict";
  const SM = window.ScholarshipModel;
  const MODEL_URL = "model/scholarship_model.xml";
  const RECORDS_URL = "data/records.json";

  // Friendlier wording for some answers. Values not listed are shown as SPSS stores them.
  const LABELS = {
    civil_status: [["Single","Single"],["Married","Married"],["Separated/Divorced","Separated or divorced"]],
    religion: [["Roman Catholic","Roman Catholic"],["Protestant / Evangelical","Protestant / Evangelical"],["Iglesia ni Cristo","Iglesia ni Cristo"],["Other","Other"]],
    home_town: [["Aglipay","Aglipay"],["Cabarroguis","Cabarroguis"],["Diffun","Diffun"],["Maddela","Maddela"],["Nagtipunan","Nagtipunan"],["Saguday","Saguday"],["Quirino (unspecified)","Quirino, town not specified"],["Outside Quirino (Isabela)","Isabela (outside Quirino)"],["Outside Quirino (Ifugao)","Ifugao (outside Quirino)"],["Outside Quirino (Nueva Vizcaya)","Nueva Vizcaya (outside Quirino)"]],
    course: [["BSCS","BSCS · Computer Science"],["BEED","BEED · Elementary Education"],["BSBA","BSBA · Business Admin."],["BSENTREP","BSENTREP · Entrepreneurship"],["BSCE","BSCE · Civil Engineering"],["BSHM","BSHM · Hospitality Mgt."],["BAELS","BAELS · English Language"],["BSMID","BSMID · Midwifery"],["BSMATH","BSMATH · Mathematics"]],
    registering_as: [["Old Student","Continuing (old) student"],["New Student","New student"],["Transfer-in","Transfer-in"]],
    year_level: [["1","1st year"],["2","2nd year"],["3","3rd year"],["4","4th year"]],
    other_supporter: [["None","No one else"],["Relative","A relative"],["Self-supporting","I support myself"],["Scholarship / Assistance","A scholarship or other assistance"],["Other","Someone else"]],
    mother_occupation: [["Housewife / Unemployed","Housewife / not employed"],["Farmer","Farmer"],["Vendor / Small business","Vendor / small business"],["OFW","OFW (overseas worker)"],["Domestic / Service worker","Domestic / service worker"],["Government / Professional","Government / professional"],["Other","Other work"],["Deceased / Absent","Deceased or absent"],["None / Not stated","Prefer not to say"]],
    mother_monthly_income: [["0","No income (₱0)"],["1-10,000","₱1 – ₱10,000"],["10,001-20,000","₱10,001 – ₱20,000"],["20,001-30,000","₱20,001 – ₱30,000"],["30,001-40,000","₱30,001 – ₱40,000"],["40,001-50,000","₱40,001 – ₱50,000"]],
    father_occupation: [["Farmer","Farmer"],["Driver / Skilled / Laborer","Driver / skilled worker / laborer"],["Vendor / Small business","Vendor / small business"],["Government / Professional","Government / professional"],["OFW","OFW (overseas worker)"],["Other","Other work"],["Housewife / Unemployed","Not employed / homemaker"],["Deceased / Absent","Deceased or absent"],["None / Not stated","Prefer not to say"]],
    father_monthly_income: [["0","No income (₱0)"],["1-10,000","₱1 – ₱10,000"],["10,001-20,000","₱10,001 – ₱20,000"],["20,001-30,000","₱20,001 – ₱30,000"]],
    mother_ethnicity: [["Not Applicable","Not applicable"]],
    father_ethnicity: [["Not Applicable","Not applicable"]]
  };
  const SELECTS = ["civil_status","religion","home_town","course","major","registering_as","year_level","other_supporter",
    "mother_occupation","mother_monthly_income","father_occupation","father_monthly_income","mother_ethnicity","father_ethnicity"];
  const RADIOS = ["sex","living_with_parents","boarding","has_dis"];
  const FIELD_NAMES = {
    sex: "Sex", birth_year: "Birth year", civil_status: "Civil status", religion: "Religion",
    home_town: "Home town", registering_as: "Enrollment status", year_level: "Year level",
    living_with_parents: "Living with parents", boarding: "Boarding", other_supporter: "Other support",
    mother_occupation: "Mother's occupation", mother_monthly_income: "Mother's income",
    father_occupation: "Father's occupation", father_monthly_income: "Father's income", disability: "Disability",
    course: "Course", major: "Major", mother_ethnicity: "Mother's ethnic group", father_ethnicity: "Father's ethnic group"
  };
  const EXAMPLE = {
    sex: "Male", birth_year: 2004, civil_status: "Single", religion: "Protestant / Evangelical",
    home_town: "Aglipay", registering_as: "Old Student", year_level: "3", course: "BSBA", major: "Marketing Management",
    mother_ethnicity: "Not Applicable", father_ethnicity: "Not Applicable",
    living_with_parents: "Yes", boarding: "Yes", other_supporter: "Relative",
    mother_occupation: "Vendor / Small business", mother_monthly_income: "1-10,000",
    father_occupation: "Driver / Skilled / Laborer", father_monthly_income: "10,001-20,000",
    has_dis: "No", dis: []
  };
  const RARE = 20;   // answers given by fewer students than this get a warning

  let MODEL = null, RECORDS = { counts: {}, majors: {} }, REF = {}, CUT = 0.5;
  const form = document.getElementById("f");
  const $ = (id) => document.getElementById(id);

  // ---------- Form ----------
  function labelFor(field, value) {
    const hit = (LABELS[field] || []).find(o => o[0] === value);
    return hit ? hit[1] : value;
  }
  function optionsFor(field) {
    if (field === "year_level") return LABELS.year_level;
    const values = Object.keys(MODEL.fields[field] || {});
    const known = (LABELS[field] || []).filter(o => values.includes(o[0]));
    const rest = values.filter(v => !known.some(o => o[0] === v) && v !== "Other").sort().map(v => [v, v]);
    const out = [...known, ...rest];
    if (values.includes("Other") && !out.some(o => o[0] === "Other")) out.push(["Other", field.endsWith("ethnicity") ? "Other group" : "Other"]);
    return out;
  }
  function fillSelect(id, opts) {
    const sel = $(id), keep = sel.value;
    sel.innerHTML = "";
    for (const [v, t] of opts) { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); }
    if (opts.some(o => o[0] === keep)) sel.value = keep;
  }
  function fillMajors() {
    const all = Object.keys(MODEL.fields.major || {});
    const list = (RECORDS.majors[$("course").value] || []).filter(m => all.includes(m));
    fillSelect("major", (list.length ? list : all.sort()).map(m => [m, m]));
  }
  function setForm(a) {
    for (const k of RADIOS) {
      const el = form.querySelector(`input[name="${k}"][value="${a[k]}"]`);
      if (el) el.checked = true;
    }
    $("course").value = a.course;
    fillMajors();
    for (const k of SELECTS) if (a[k] !== undefined) $(k).value = a[k];
    $("birth_year").value = a.birth_year;
    form.querySelectorAll('input[name="dis"]').forEach(c => { c.checked = a.dis.includes(c.value); });
    $("disTypes").hidden = a.has_dis !== "Yes";
  }
  function readForm() {
    const a = {};
    for (const k of RADIOS) {
      const el = form.querySelector(`input[name="${k}"]:checked`);
      a[k] = el ? el.value : null;
    }
    for (const k of SELECTS) a[k] = $(k).value;
    a.birth_year = parseInt($("birth_year").value, 10);
    a.dis = [...form.querySelectorAll('input[name="dis"]:checked')].map(c => c.value);
    return a;
  }

  // ---------- Display ----------
  function fmtPct(p) {
    if (p > 0.995) return { big: "99", sup: "%+", text: "over 99%" };
    if (p < 0.005) return { big: "<1", sup: "%", text: "under 1%" };
    const n = Math.round(p * 100);
    return { big: String(n), sup: "%", text: n + "%" };
  }
  const ICON = {
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>'
  };
  function valueText(f, a) {
    if (f === "birth_year") return String(Number.isFinite(a.birth_year) ? a.birth_year : 2005);
    if (f === "sex" || f === "living_with_parents" || f === "boarding") return a[f];
    if (f === "disability") {
      if (a.has_dis !== "Yes") return "None";
      const names = { dis_visual: "visual", dis_physical: "physical", dis_speech: "speech and language", dis_mental: "mental", dis_psych: "psychological", dis_learning: "learning", dis_rare: "rare disease", other: "other" };
      return a.dis.length ? a.dis.map(k => names[k]).join(", ") : "Yes";
    }
    return labelFor(f, a[f]);
  }

  function render() {
    if (!MODEL) return;
    const a = readForm();
    $("disTypes").hidden = a.has_dis !== "Yes";
    const { p, c } = SM.score(MODEL, a);
    const pct = fmtPct(p);
    const good = p >= CUT;
    const cutTxt = Math.round(CUT * 100) + "%";

    $("score").innerHTML = `${pct.big}<small>${pct.sup}</small>`;
    const v = $("verdict");
    v.className = "pill " + (good ? "good" : "low");
    v.innerHTML = (good ? ICON.check : ICON.dash) + (good ? "Likely grantee" : "Less likely");
    const fill = $("fill");
    fill.className = "fill " + (good ? "good" : "low");
    fill.style.width = Math.max(2, Math.min(100, p * 100)) + "%";
    $("summary").textContent = good
      ? `In the records, students with answers like yours were grantees more often than not. Your score of ${pct.text} is above the ${cutTxt} cutoff.`
      : `In the records, students with answers like yours were grantees less often than not. Your score of ${pct.text} is below the ${cutTxt} cutoff.`;
    $("dockScore").textContent = pct.text.replace("over ", ">").replace("under ", "<");
    $("dockVerdict").textContent = good ? "Likely grantee" : "Less likely";

    // Real-rate correction (researchers only)
    const rate = parseFloat($("rate").value);
    const real = $("real");
    if (rate > 0 && rate < 100) {
      real.hidden = false;
      real.innerHTML = `<b>Estimated real chance: ${fmtPct(SM.adjustForRate(p, rate / 100)).text}</b>, if ${rate}% of students really receive a scholarship.`;
    } else real.hidden = true;

    // What affected the score: each answer compared with the most common answer
    const items = Object.entries(c).map(([f, val]) => [f, val - (REF[f] ?? 0)])
      .filter(([, d]) => Math.abs(d) >= 0.15)
      .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 5);
    const ul = $("factors");
    ul.innerHTML = "";
    if (!items.length) {
      ul.innerHTML = '<li class="factor up"><span class="ico">' + ICON.dash + '</span><span class="what"><b>No single answer stands out</b><span>Your answers match the most common answers in the records.</span></span><span></span></li>';
    }
    for (const [f, dlt] of items) {
      const up = dlt > 0;
      const li = document.createElement("li");
      li.className = "factor " + (up ? "up" : "down");
      li.innerHTML = `<span class="ico">${up ? ICON.up : ICON.down}</span><span class="what"><b></b><span></span></span><span class="dir">${up ? "Raises" : "Lowers"}</span>`;
      li.querySelector(".what b").textContent = FIELD_NAMES[f] || f;
      li.querySelector(".what span").textContent = valueText(f, a);
      ul.appendChild(li);
    }

    // Notes
    const notes = [];
    if (a.registering_as === "New Student") notes.push("None of the 56 new students in the records were grantees, so a new student's score is always very low.");
    if (a.registering_as === "Transfer-in") notes.push("Only 1 of the 16 transfer-in students in the records was a grantee.");
    for (const f of Object.keys(MODEL.fields)) {
      const n = RECORDS.counts[f]?.[a[f]];
      if (n !== undefined && n < RARE && f !== "registering_as") {
        notes.push(`Only ${n} student${n === 1 ? "" : "s"} in the records had "${labelFor(f, a[f])}" for ${(FIELD_NAMES[f] || f).toLowerCase()}, so this part of the prediction is unreliable.`);
      }
    }
    if (a.has_dis === "Yes") notes.push("Only 71 students in the records reported a disability, so the disability part of the prediction is less reliable.");
    const byFlag = $("birth_flag");
    if (Number.isFinite(a.birth_year) && (a.birth_year < 1991 || a.birth_year > 2008)) {
      byFlag.hidden = false;
      byFlag.textContent = "Students in the records were born between 1991 and 2008, so a year outside that range is less reliable.";
    } else if (!Number.isFinite(a.birth_year)) {
      byFlag.hidden = false;
      byFlag.textContent = "Enter your birth year. Until then, 2005 is used.";
    } else byFlag.hidden = true;
    const nb = $("notes");
    nb.innerHTML = "";
    for (const t of notes) { const li = document.createElement("li"); li.textContent = t; nb.appendChild(li); }
    $("notesBox").hidden = notes.length === 0;
  }

  // ---------- Events ----------
  let touched = false;
  form.addEventListener("input", () => {
    if (!touched) { touched = true; $("exampleNote").querySelector("p").innerHTML = "<b>Showing your answers.</b> The result updates as you change them."; }
    render();
  });
  form.addEventListener("change", (e) => { if (e.target.id === "course" && MODEL) fillMajors(); render(); });
  form.addEventListener("submit", (e) => e.preventDefault());
  $("rate").addEventListener("input", render);
  $("resetBtn").addEventListener("click", () => {
    if (!MODEL) return;
    setForm(EXAMPLE); touched = false;
    $("exampleNote").querySelector("p").innerHTML = "<b>These are example answers.</b> Change them to match you. The result updates as you go.";
    render();
  });

  // Sunburst rays in the header
  (function rays() {
    const n = 24, r0 = 30, r1 = 98;
    let s = "";
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = a0 + Math.PI / n * 0.55;
      const pt = (r, t) => `${(r * Math.cos(t)).toFixed(2)},${(r * Math.sin(t)).toFixed(2)}`;
      s += `<polygon points="${pt(r0, a0)} ${pt(r1, a0)} ${pt(r1, a1)} ${pt(r0, a1)}"/>`;
    }
    $("rays").innerHTML = s;
  })();

  // Hide the phone score bar while the result card is on screen
  try {
    const dock = $("dock");
    new IntersectionObserver((es) => { for (const e of es) dock.classList.toggle("away", e.isIntersecting); }, { threshold: 0.25 }).observe($("result"));
  } catch (e) { /* the bar simply stays visible */ }

  // ---------- Start: load the model and the records summary, then build the form ----------
  function showLoadError(msg) {
    $("score").textContent = "–";
    $("summary").textContent = "The predictor can't run until the model file loads.";
    const e = $("loadError");
    e.hidden = false;
    e.textContent = msg;
    $("version").textContent = "Model file not loaded.";
  }
  const records = fetch(RECORDS_URL, { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  Promise.all([SM.load(MODEL_URL), records])
    .then(([model, rec]) => {
      MODEL = model;
      if (rec) RECORDS = rec;
      CUT = MODEL.cutoff;
      $("cut").style.left = (CUT * 100) + "%";
      $("cutLabel").textContent = Math.round(CUT * 100) + "% cutoff";
      for (const f of SELECTS) if (f !== "major") fillSelect(f, optionsFor(f));
      REF = SM.reference(MODEL, RECORDS.counts);
      setForm(EXAMPLE);
      $("loadError").hidden = true;
      $("version").textContent = `Model file: ${MODEL_URL} · saved by ${MODEL.app} · ${MODEL.parameters} parameters · cutoff ${CUT}`;
      render();
    })
    .catch(err => {
      showLoadError(location.protocol === "file:"
        ? "Browsers don't let a page opened from your own computer read the model file. Open the website link instead."
        : (err && err.message) || "The model file could not be loaded.");
    });
})();
