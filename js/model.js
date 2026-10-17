/* model.js: the prediction engine.
   Reads the logistic regression model that IBM SPSS saved (PMML/XML) and
   calculates a student's score. There is no page or form code in this file;
   app.js handles everything the student sees. */
(function (global) {
  "use strict";

  // SPSS variable name -> answer on the form
  const FACTOR_FIELDS = {
    sex_n: "sex", mother_eth_n: "mother_ethnicity", father_eth_n: "father_ethnicity",
    civil_n: "civil_status", religion_n: "religion", home_town_n: "home_town",
    course_n: "course", major_n: "major", registering_n: "registering_as",
    living_n: "living_with_parents", mother_occ_n: "mother_occupation",
    mother_inc_n: "mother_monthly_income", father_occ_n: "father_occupation",
    father_inc_n: "father_monthly_income", boarding_n: "boarding", supporter_n: "other_supporter"
  };
  // SPSS covariate -> which answer it belongs to (used to explain the score)
  const COVARIATE_GROUP = {
    birth_year: "birth_year", year_level: "year_level", year_level_missing: "year_level",
    has_disability: "disability", dis_visual: "disability", dis_physical: "disability",
    dis_speech: "disability", dis_mental: "disability", dis_psych: "disability",
    dis_learning: "disability", dis_rare: "disability"
  };
  const DIS_KEYS = ["dis_visual", "dis_physical", "dis_speech", "dis_mental", "dis_psych", "dis_learning", "dis_rare"];
  const DEFAULT_BIRTH_YEAR = 2005;   // value SPSS used for missing birth years

  function kids(el, name) { return el ? [...el.children].filter(c => c.localName === name) : []; }
  function first(el, name) { return el ? el.getElementsByTagNameNS("*", name)[0] : undefined; }

  /** Read the PMML text that SPSS saved with /OUTFILE=MODEL(...). */
  function parsePMML(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("The model file is not valid XML.");
    const codes = {};   // SPSS variable -> { code: label }
    for (const f of doc.getElementsByTagNameNS("*", "DataField")) {
      const m = {};
      for (const v of kids(f, "Value")) m[v.getAttribute("value")] = v.getAttribute("displayValue") ?? v.getAttribute("value");
      codes[f.getAttribute("name")] = m;
    }
    const g = first(doc, "GeneralRegressionModel");
    if (!g) throw new Error("The model file does not contain a logistic regression model.");
    const factors = kids(first(g, "FactorList"), "Predictor").map(p => p.getAttribute("name"));
    const covariates = kids(first(g, "CovariateList"), "Predictor").map(p => p.getAttribute("name"));
    const cells = {};   // parameter -> [[predictor, value], ...]
    for (const c of kids(first(g, "PPMatrix"), "PPCell")) {
      const p = c.getAttribute("parameterName");
      (cells[p] ||= []).push([c.getAttribute("predictorName"), c.getAttribute("value")]);
    }
    const params = kids(first(g, "ParamMatrix"), "PCell").map(c => ({
      name: c.getAttribute("parameterName"),
      beta: parseFloat(c.getAttribute("beta")),
      cells: cells[c.getAttribute("parameterName")] || []
    }));
    let cutoff = 0.5;
    for (const e of kids(g, "Extension")) if (e.getAttribute("name") === "cutoff") cutoff = parseFloat(e.getAttribute("value")) || 0.5;
    const app = first(doc, "Application");
    return {
      codes, factors, covariates, params, cutoff,
      app: app ? `${app.getAttribute("name")} ${app.getAttribute("version")}` : "IBM SPSS Statistics"
    };
  }

  /** Turn the parsed file into answer -> effect (B) tables. */
  function build(pm) {
    const M = { pm, constant: 0, cov: {}, fields: {}, other: [], cutoff: pm.cutoff, app: pm.app, parameters: pm.params.length };
    for (const [spss, field] of Object.entries(FACTOR_FIELDS)) {
      if (!pm.factors.includes(spss)) continue;
      M.fields[field] = {};
      for (const label of Object.values(pm.codes[spss] || {})) M.fields[field][label] = 0;   // reference category
    }
    for (const p of pm.params) {
      if (p.cells.length === 0) { M.constant += p.beta; continue; }
      if (p.cells.length === 1) {
        const [pred, val] = p.cells[0];
        if (FACTOR_FIELDS[pred] && pm.factors.includes(pred)) {
          M.fields[FACTOR_FIELDS[pred]][pm.codes[pred]?.[val] ?? val] = p.beta;
          continue;
        }
        if (pm.covariates.includes(pred) && Number(val) === 1) { M.cov[pred] = (M.cov[pred] || 0) + p.beta; continue; }
      }
      M.other.push(p);   // e.g. interaction terms; still scored in score()
    }
    const unknown = [...pm.factors.filter(f => !FACTOR_FIELDS[f]), ...pm.covariates.filter(c => !(c in COVARIATE_GROUP))];
    if (unknown.length) throw new Error("The model uses variables the page does not ask about: " + unknown.join(", ") + ".");
    return M;
  }

  /** Numbers for the covariates, from a student's answers. */
  function covariateValues(a) {
    const hasDis = a.has_dis === "Yes";
    const x = {
      birth_year: Number.isFinite(a.birth_year) ? a.birth_year : DEFAULT_BIRTH_YEAR,
      year_level: Number(a.year_level),
      year_level_missing: 0,
      has_disability: hasDis ? 1 : 0
    };
    for (const k of DIS_KEYS) x[k] = hasDis && (a.dis || []).includes(k) ? 1 : 0;
    return x;
  }

  /** The logistic regression equation: z = constant + sum of B x value; p = 1 / (1 + e^-z).
      Returns p, z and each answer's contribution to z. */
  function score(M, a) {
    const x = covariateValues(a);
    const c = {};
    for (const f of Object.keys(M.fields)) c[f] = M.fields[f][a[f]] ?? 0;
    for (const [cv, b] of Object.entries(M.cov)) {
      const grp = COVARIATE_GROUP[cv];
      c[grp] = (c[grp] || 0) + b * x[cv];
    }
    let z = M.constant;
    for (const v of Object.values(c)) z += v;
    for (const p of M.other) {
      let t = 1;
      for (const [pred, val] of p.cells) {
        if (FACTOR_FIELDS[pred]) t *= (M.pm.codes[pred]?.[val] === a[FACTOR_FIELDS[pred]]) ? 1 : 0;
        else t *= Math.pow(x[pred], Number(val));
      }
      z += p.beta * t;
    }
    return { p: 1 / (1 + Math.exp(-z)), z, c };
  }

  /** Contribution of the most common answer to each question, for "raises / lowers". */
  function reference(M, counts) {
    const ref = { birth_year: 0, year_level: 0, disability: 0 };
    const base = covariateValues({ birth_year: DEFAULT_BIRTH_YEAR, year_level: "3", has_dis: "No", dis: [] });
    for (const [cv, b] of Object.entries(M.cov)) ref[COVARIATE_GROUP[cv]] += b * base[cv];
    for (const f of Object.keys(M.fields)) {
      const cnt = (counts || {})[f] || {};
      const keys = Object.keys(cnt);
      const mode = keys.length ? keys.reduce((x, y) => (cnt[y] > cnt[x] ? y : x)) : Object.keys(M.fields[f])[0];
      ref[f] = M.fields[f][mode] ?? 0;
    }
    return ref;
  }

  /** Real-rate correction: turn a balanced-data score into an estimated real chance. */
  function adjustForRate(p, rate) {
    const odds = (p / (1 - p)) * (rate / (1 - rate));
    return odds / (1 + odds);
  }

  /** Download and build the model. */
  async function load(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`The model file ${url} was not found (error ${r.status}). Check that it is uploaded in a folder named "model".`);
    return build(parsePMML(await r.text()));
  }

  global.ScholarshipModel = { load, parsePMML, build, score, reference, adjustForRate, FACTOR_FIELDS };
})(window);
