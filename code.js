// ============================================================
// Azzas Re-skin Multi-marca — v9
// Fix: hardcoded ID first, scan ALL frames, prefer by name
// ============================================================

figma.showUI(__html__, { width: 400, height: 520, themeColors: true });

var KNOWN_TOKENS_WEB_ID =
  "VariableCollectionId:9b93edd583610debef2925da9b640d64a24ae03c/17075:0";
var MIN_MODES = 3;

var cachedCollection = null;

// ── Helpers ──────────────────────────────────────────────────

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error("TIMEOUT")); }, ms);
    })
  ]);
}

async function safeGetCollection(id) {
  try {
    return await withTimeout(
      figma.variables.getVariableCollectionByIdAsync(id),
      5000
    );
  } catch (_) {
    return null;
  }
}

// ── Detection (3 strategies) ────────────────────────────────

async function detectCollection() {
  // Strategy 1 — hardcoded known ID (instant, avoids ordering issues)
  console.log("[Re-skin] Strategy 1: trying hardcoded ID...");
  var coll = await safeGetCollection(KNOWN_TOKENS_WEB_ID);
  if (coll && coll.modes.length >= MIN_MODES) {
    console.log("[Re-skin] ✓ Found via hardcoded ID: \"" + coll.name + "\" (" + coll.modes.length + " modes)");
    return coll;
  }
  console.log("[Re-skin] Hardcoded ID miss.");

  // Strategy 2 — scan resolvedVariableModes on ALL top-level frames
  // (v8 only checked the FIRST frame — if that frame had no tokens, it failed)
  console.log("[Re-skin] Strategy 2: scanning all frames on current page...");
  var page = figma.currentPage;
  var candidateIds = {};

  for (var i = 0; i < page.children.length; i++) {
    var res = page.children[i].resolvedVariableModes;
    if (res) {
      var keys = Object.keys(res);
      for (var k = 0; k < keys.length; k++) {
        candidateIds[keys[k]] = true;
      }
    }
  }

  var ids = Object.keys(candidateIds);
  console.log("[Re-skin] Found " + ids.length + " unique collectionIds across all frames.");

  // Test each candidate — prefer "Tokens WEB" by name, else pick most modes
  var best = null;
  for (var c = 0; c < ids.length; c++) {
    console.log("[Re-skin] Testing [" + c + "] " + ids[c] + "...");

    var candidate = await safeGetCollection(ids[c]);
    if (!candidate) {
      console.log("[Re-skin]   → null (could not resolve)");
      continue;
    }

    console.log("[Re-skin]   → \"" + candidate.name + "\" with " + candidate.modes.length + " modes");

    if (candidate.modes.length < MIN_MODES) continue;

    // Exact name match = instant win
    if (candidate.name === "Tokens WEB") return candidate;

    // Otherwise track the one with most modes
    if (!best || candidate.modes.length > best.modes.length) {
      best = candidate;
    }
  }

  if (best) {
    console.log("[Re-skin] ✓ Best match: \"" + best.name + "\" (" + best.modes.length + " modes)");
    return best;
  }

  // Strategy 3 — library API fallback (known to not return "Tokens WEB" in
  // some setups, but worth trying)
  console.log("[Re-skin] Strategy 3: trying library API...");
  try {
    var libs = await withTimeout(
      figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync(),
      5000
    );
    for (var l = 0; l < libs.length; l++) {
      if (libs[l].name === "Tokens WEB") {
        var imported = await withTimeout(
          figma.teamLibrary.getVariablesInLibraryCollectionAsync(libs[l].key),
          10000
        );
        if (imported.length > 0) {
          var v = await withTimeout(
            figma.variables.importVariableByKeyAsync(imported[0].key),
            5000
          );
          if (v && v.variableCollectionId) {
            return await safeGetCollection(v.variableCollectionId);
          }
        }
      }
    }
  } catch (_) {}

  return null;
}

// ── Init ────────────────────────────────────────────────────

(async function() {
  figma.ui.postMessage({
    type: "progress",
    message: "Detectando tokens...",
    current: 0, total: 1
  });

  try {
    var collection = await detectCollection();

    if (!collection) {
      figma.ui.postMessage({
        type: "error",
        message: "Nenhuma collection com 3+ modes (marcas) encontrada.\n\n" +
          "Verifique se este arquivo usa tokens da Tokens Library com múltiplas marcas " +
          "e que a library está habilitada."
      });
      return;
    }

    cachedCollection = collection;
    var brands = collection.modes.map(function(m) { return m.name; });

    figma.notify("\"" + collection.name + "\" — " + brands.length + " marcas!", { timeout: 3000 });
    figma.ui.postMessage({ type: "brands", brands: brands });

  } catch (err) {
    figma.ui.postMessage({ type: "error", message: "Erro: " + err.message });
  }
})();

// ── Re-skin ─────────────────────────────────────────────────

function findModeByName(brandName) {
  var mode = cachedCollection.modes.find(function(m) {
    return m.name.toLowerCase() === brandName.toLowerCase();
  });
  return mode ? mode.modeId : null;
}

async function reskin(targetBrand) {
  var startTime = Date.now();
  var report = {
    pagesProcessed: 0, framesProcessed: 0, modesSwapped: 0,
    logosSwapped: 0, warnings: [], errors: [], timeMs: 0,
  };

  var targetModeId = findModeByName(targetBrand);
  if (!targetModeId) {
    report.errors.push("Marca \"" + targetBrand + "\" não encontrada.");
    report.timeMs = Date.now() - startTime;
    return report;
  }

  figma.skipInvisibleInstanceChildren = true;
  var pages = figma.root.children;

  for (var p = 0; p < pages.length; p++) {
    var pg = pages[p];
    figma.ui.postMessage({
      type: "progress",
      message: pg.name + " (" + (p+1) + "/" + pages.length + ")",
      current: p + 1, total: pages.length,
    });

    await pg.loadAsync();

    for (var i = 0; i < pg.children.length; i++) {
      var topFrame = pg.children[i];
      if (
        topFrame.type === "FRAME" ||
        topFrame.type === "COMPONENT" ||
        topFrame.type === "COMPONENT_SET" ||
        topFrame.type === "SECTION"
      ) {
        try {
          topFrame.setExplicitVariableModeForCollection(cachedCollection, targetModeId);
          report.modesSwapped++;
          report.framesProcessed++;
        } catch (err) {
          report.errors.push("Frame \"" + topFrame.name + "\": " + err.message);
        }
      }
    }
    report.pagesProcessed++;
  }

  report.timeMs = Date.now() - startTime;
  return report;
}

// ── Message handler ─────────────────────────────────────────

figma.ui.onmessage = async function(msg) {
  if (msg.type === "reskin" && msg.targetBrand) {
    figma.ui.postMessage({
      type: "progress",
      message: "Iniciando re-skin...",
      current: 0, total: 1
    });
    try {
      var report = await reskin(msg.targetBrand);
      figma.ui.postMessage({ type: "report", report: report });
      if (report.errors.length === 0) {
        figma.notify(
          "Re-skin para " + msg.targetBrand + " concluído! " +
          report.modesSwapped + " modes em " + report.pagesProcessed + " páginas.",
          { timeout: 5000 }
        );
      } else {
        figma.notify(
          "Re-skin com " + report.errors.length + " erro(s).",
          { timeout: 5000, error: true }
        );
      }
    } catch (err) {
      figma.ui.postMessage({ type: "error", message: "Erro: " + err.message });
    }
  }
  if (msg.type === "cancel") { figma.closePlugin(); }
};
