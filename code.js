// Azzas Re-skin Multi-marca — Figma Plugin
// Swaps variable modes on "Tokens WEB" collection across all pages.

var KNOWN_TOKENS_WEB_ID =
  "VariableCollectionId:9b93edd583610debef2925da9b640d64a24ae03c/17075:0";

var MIN_MODES = 3; // "Tokens WEB" has 10 modes; "Layout" has only 2

// ── Boot ──────────────────────────────────────────────────────────────
figma.showUI(__html__, { width: 420, height: 520, themeColors: true });

(async function init() {
  try {
    var collection = await detectCollection();
    if (!collection) {
      figma.ui.postMessage({ type: "error", message: "Não foi possível encontrar a collection \"Tokens WEB\". Verifique se a library está habilitada neste arquivo." });
      return;
    }

    var modes = collection.modes.map(function (m) {
      return { id: m.modeId, name: m.name };
    });

    figma.ui.postMessage({
      type: "modes-loaded",
      collectionName: collection.name,
      collectionId: collection.id,
      modes: modes,
    });
  } catch (err) {
    figma.ui.postMessage({ type: "error", message: "Erro na inicialização: " + String(err) });
  }
})();

// ── Detection ─────────────────────────────────────────────────────────
async function detectCollection() {
  // Strategy 1 — known hardcoded ID (instant)
  var coll = await safeGetCollection(KNOWN_TOKENS_WEB_ID);
  if (coll && coll.modes.length >= MIN_MODES) {
    console.log("[reskin] Detected via hardcoded ID:", coll.name, "(" + coll.modes.length + " modes)");
    return coll;
  }

  // Strategy 2 — scan resolvedVariableModes on current page frames
  console.log("[reskin] Hardcoded ID miss. Scanning resolvedVariableModes…");
  coll = await scanResolvedModes();
  if (coll) {
    console.log("[reskin] Detected via scan:", coll.name, "(" + coll.modes.length + " modes)");
    return coll;
  }

  // Strategy 3 — try library API (may not return "Tokens WEB", but worth a shot)
  console.log("[reskin] Scan miss. Trying library API…");
  coll = await tryLibraryApi();
  if (coll) {
    console.log("[reskin] Detected via library API:", coll.name, "(" + coll.modes.length + " modes)");
    return coll;
  }

  return null;
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

async function scanResolvedModes() {
  var page = figma.currentPage;
  var candidateIds = {};

  // Collect all collection IDs from top-level frames
  for (var i = 0; i < page.children.length; i++) {
    var node = page.children[i];
    var resolved = node.resolvedVariableModes;
    if (!resolved) continue;
    var keys = Object.keys(resolved);
    for (var k = 0; k < keys.length; k++) {
      candidateIds[keys[k]] = true;
    }
  }

  var ids = Object.keys(candidateIds);
  console.log("[reskin] Found " + ids.length + " candidate collection IDs");

  // Resolve each and pick the one with most modes (>= MIN_MODES)
  var best = null;
  for (var j = 0; j < ids.length; j++) {
    var c = await safeGetCollection(ids[j]);
    if (!c) continue;
    if (c.modes.length < MIN_MODES) continue;
    // Prefer collection named "Tokens WEB" exactly
    if (c.name === "Tokens WEB") return c;
    if (!best || c.modes.length > best.modes.length) best = c;
  }
  return best;
}

async function tryLibraryApi() {
  try {
    var libs = await withTimeout(
      figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync(),
      5000
    );
    for (var i = 0; i < libs.length; i++) {
      if (libs[i].name === "Tokens WEB") {
        var imported = await withTimeout(
          figma.teamLibrary.getVariablesInLibraryCollectionAsync(libs[i].key),
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

// ── Swap logic ────────────────────────────────────────────────────────
figma.ui.onmessage = async function (msg) {
  if (msg.type === "swap") {
    await performSwap(msg.collectionId, msg.targetModeId);
  }
  if (msg.type === "cancel") {
    figma.closePlugin();
  }
};

async function performSwap(collectionId, targetModeId) {
  var collection = await safeGetCollection(collectionId);
  if (!collection) {
    figma.ui.postMessage({ type: "error", message: "Collection não encontrada para o swap." });
    return;
  }

  var pages = figma.root.children;
  var totalFrames = 0;
  var totalPages = 0;
  var errors = [];

  figma.ui.postMessage({ type: "swap-start", totalPages: pages.length });

  for (var p = 0; p < pages.length; p++) {
    var page = pages[p];

    // Load page content (required with dynamic-page access)
    try {
      await page.loadAsync();
    } catch (loadErr) {
      errors.push({ page: page.name, error: "Falha ao carregar página: " + String(loadErr) });
      continue;
    }

    var framesSwapped = 0;

    for (var f = 0; f < page.children.length; f++) {
      var frame = page.children[f];
      try {
        frame.setExplicitVariableModeForCollection(collection, targetModeId);
        framesSwapped++;
      } catch (swapErr) {
        // Some nodes may not support this — that's OK
        console.log("[reskin] Skip " + frame.name + ": " + String(swapErr));
      }
    }

    totalFrames += framesSwapped;
    if (framesSwapped > 0) totalPages++;

    figma.ui.postMessage({
      type: "swap-progress",
      currentPage: p + 1,
      pageName: page.name,
      framesSwapped: framesSwapped,
    });
  }

  figma.ui.postMessage({
    type: "swap-done",
    totalPages: totalPages,
    totalFrames: totalFrames,
    errors: errors,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () {
        reject(new Error("Timeout (" + ms + "ms)"));
      }, ms);
    }),
  ]);
}
