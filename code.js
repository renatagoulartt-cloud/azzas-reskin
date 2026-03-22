// ============================================================
// Azzas Re-skin Multi-marca — v11
// Fix: auto-load fonts before applying modes (retry on font errors)
// + try ALL strategies, pick collection with MOST modes
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
  var results = [];   // { collection, source }

  // Strategy 1 — hardcoded known ID
  console.log("[Re-skin] Strategy 1: trying hardcoded ID...");
  var coll = await safeGetCollection(KNOWN_TOKENS_WEB_ID);
  if (coll && coll.modes.length >= MIN_MODES) {
    console.log("[Re-skin] ✓ Hardcoded ID: \"" + coll.name + "\" (" + coll.modes.length + " modes)");
    results.push({ collection: coll, source: "hardcoded" });
  } else {
    console.log("[Re-skin] Hardcoded ID miss.");
  }

  // Strategy 2 — scan resolvedVariableModes on ALL top-level frames
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

  var bestFrame = null;
  for (var c = 0; c < ids.length; c++) {
    console.log("[Re-skin] Testing [" + c + "] " + ids[c] + "...");
    var candidate = await safeGetCollection(ids[c]);
    if (!candidate) {
      console.log("[Re-skin]   → null (could not resolve)");
      continue;
    }
    console.log("[Re-skin]   → \"" + candidate.name + "\" with " + candidate.modes.length + " modes");
    if (candidate.modes.length < MIN_MODES) continue;
    if (candidate.name === "Tokens WEB") {
      bestFrame = candidate;
      break;
    }
    if (!bestFrame || candidate.modes.length > bestFrame.modes.length) {
      bestFrame = candidate;
    }
  }
  if (bestFrame) {
    console.log("[Re-skin] ✓ Frame best: \"" + bestFrame.name + "\" (" + bestFrame.modes.length + " modes)");
    results.push({ collection: bestFrame, source: "frame-scan" });
  }

  // Strategy 3 — library API (may return updated modes not yet in local cache)
  console.log("[Re-skin] Strategy 3: trying library API...");
  try {
    var libs = await withTimeout(
      figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync(),
      5000
    );
    console.log("[Re-skin] Library collections found: " + libs.length);
    for (var l = 0; l < libs.length; l++) {
      console.log("[Re-skin]   lib[" + l + "]: \"" + libs[l].name + "\"");
      if (libs[l].name === "Tokens WEB") {
        var imported = await withTimeout(
          figma.teamLibrary.getVariablesInLibraryCollectionAsync(libs[l].key),
          10000
        );
        console.log("[Re-skin]   Variables in lib: " + imported.length);
        if (imported.length > 0) {
          var v = await withTimeout(
            figma.variables.importVariableByKeyAsync(imported[0].key),
            5000
          );
          if (v && v.variableCollectionId) {
            var libColl = await safeGetCollection(v.variableCollectionId);
            if (libColl && libColl.modes.length >= MIN_MODES) {
              console.log("[Re-skin] ✓ Library API: \"" + libColl.name + "\" (" + libColl.modes.length + " modes)");
              results.push({ collection: libColl, source: "library-api" });
            }
          }
        }
      }
    }
  } catch (e) {
    console.log("[Re-skin] Strategy 3 error: " + e.message);
  }

  // Pick collection with the MOST modes (most up-to-date)
  if (results.length === 0) return null;

  var winner = results[0];
  for (var r = 1; r < results.length; r++) {
    if (results[r].collection.modes.length > winner.collection.modes.length) {
      winner = results[r];
    }
  }

  console.log("[Re-skin] ✓ Winner: \"" + winner.collection.name + "\" via " + winner.source +
    " (" + winner.collection.modes.length + " modes: " +
    winner.collection.modes.map(function(m) { return m.name; }).join(", ") + ")");

  return winner.collection;
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

// ── Font helpers ────────────────────────────────────────────

function parseFontsFromError(errMsg) {
  var fonts = [];
  var regex = /unloaded font "([^"]+)"/g;
  var match;
  while ((match = regex.exec(errMsg)) !== null) {
    var raw = match[1]; // e.g. "Hero New Regular", "Hero New Bold"
    var lastSpace = raw.lastIndexOf(" ");
    if (lastSpace > 0) {
      fonts.push({
        family: raw.substring(0, lastSpace),
        style: raw.substring(lastSpace + 1)
      });
    }
  }
  return fonts;
}

async function loadFonts(fonts) {
  for (var f = 0; f < fonts.length; f++) {
    try {
      await figma.loadFontAsync(fonts[f]);
      console.log("[Re-skin] Loaded font: " + fonts[f].family + " " + fonts[f].style);
    } catch (e) {
      console.log("[Re-skin] Could not load font: " + fonts[f].family + " " + fonts[f].style + " — " + e.message);
    }
  }
}

// Collect all fonts used by text nodes in a subtree
function collectTextFonts(node) {
  var fonts = {};
  if (node.type === "TEXT") {
    var len = node.characters ? node.characters.length : 0;
    if (len > 0) {
      // fontName can be a single value or mixed (Symbol)
      var fn = node.fontName;
      if (fn && typeof fn === "object" && fn.family) {
        var key = fn.family + "|" + fn.style;
        fonts[key] = { family: fn.family, style: fn.style };
      } else {
        // Mixed fonts — get per-character (sample first, mid, last)
        var indices = [0];
        if (len > 1) indices.push(Math.floor(len / 2));
        if (len > 2) indices.push(len - 1);
        for (var s = 0; s < indices.length; s++) {
          try {
            var rf = node.getRangeFontName(indices[s], indices[s] + 1);
            if (rf && rf.family) {
              var rk = rf.family + "|" + rf.style;
              fonts[rk] = { family: rf.family, style: rf.style };
            }
          } catch (_) {}
        }
      }
    }
  }
  if ("children" in node) {
    for (var c = 0; c < node.children.length; c++) {
      var childFonts = collectTextFonts(node.children[c]);
      var childKeys = Object.keys(childFonts);
      for (var ck = 0; ck < childKeys.length; ck++) {
        fonts[childKeys[ck]] = childFonts[childKeys[ck]];
      }
    }
  }
  return fonts;
}

// Pre-load fonts that the TARGET mode will need (from string variables)
async function preloadFontsForTargetMode(collection, targetModeId) {
  console.log("[Re-skin] Pre-loading fonts for target mode...");
  try {
    var allVars = await figma.variables.getVariablesInCollectionAsync(collection.id);
    var fontFamilies = {};
    for (var i = 0; i < allVars.length; i++) {
      var v = allVars[i];
      if (v.resolvedType === "STRING" && v.name.toLowerCase().indexOf("font") !== -1) {
        var val = v.valuesByMode[targetModeId];
        if (typeof val === "string" && val.length > 1 && val.length < 60) {
          fontFamilies[val] = true;
        }
      }
    }
    var families = Object.keys(fontFamilies);
    console.log("[Re-skin] Font families from variables: " + (families.length > 0 ? families.join(", ") : "(none)"));
    var styles = ["Regular", "Bold", "Medium", "Light", "SemiBold", "Italic"];
    for (var fi = 0; fi < families.length; fi++) {
      for (var si = 0; si < styles.length; si++) {
        try {
          await figma.loadFontAsync({ family: families[fi], style: styles[si] });
          console.log("[Re-skin] Pre-loaded: " + families[fi] + " " + styles[si]);
        } catch (_) {}
      }
    }
  } catch (e) {
    console.log("[Re-skin] Pre-load scan error: " + e.message);
  }
}

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

  // Pre-load fonts that the target brand mode will need
  figma.ui.postMessage({
    type: "progress",
    message: "Carregando fontes...",
    current: 0, total: 1
  });
  await preloadFontsForTargetMode(cachedCollection, targetModeId);

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
        // Attempt with retry on font errors
        var applied = false;
        for (var attempt = 0; attempt < 3 && !applied; attempt++) {
          try {
            topFrame.setExplicitVariableModeForCollection(cachedCollection, targetModeId);
            report.modesSwapped++;
            report.framesProcessed++;
            applied = true;
          } catch (err) {
            var msg = err.message || "";
            if (msg.indexOf("unloaded font") !== -1 && attempt < 2) {
              console.log("[Re-skin] Font error on \"" + topFrame.name + "\", loading fonts (attempt " + (attempt+1) + ")...");
              // Load fonts mentioned in the error
              var neededFonts = parseFontsFromError(msg);
              await loadFonts(neededFonts);
              // Also load fonts from text nodes in this frame
              if (attempt === 0) {
                try {
                  var textFonts = collectTextFonts(topFrame);
                  var textFontList = Object.keys(textFonts).map(function(k) { return textFonts[k]; });
                  await loadFonts(textFontList);
                } catch (_) {}
              }
            } else {
              report.errors.push("Frame \"" + topFrame.name + "\": " + msg);
              break;
            }
          }
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
