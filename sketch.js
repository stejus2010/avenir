let cameraInput;
let extractedTextElement;
let harmfulIngredientsData = {};
let currentUserPlan = 'free';
let scanCount = 0;
let analysisCount = 0;

// Load ingredients JSON
fetch('ingredients_pro_mode.json')
  .then(r => r.json())
  .then(data => harmfulIngredientsData = data.harmfulIngredients || {})
  .catch(err => console.error('ingredients.json load err', err));

function setup() {
  noCanvas();
  extractedTextElement = document.getElementById('extracted-text');

  // Track user plan and usage
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      const doc = await db.collection('users').doc(user.uid).get();
      if (doc.exists) {
        const data = doc.data();
        currentUserPlan = data.plan || 'free';
        scanCount = data.scansToday || 0;
        analysisCount = data.analysisToday || 0;
      } else {
        currentUserPlan = 'free';
      }
    } else currentUserPlan = 'free';
    updateUsageUI();
  });
}

// 🎥 Start Camera
function startCamera() {
  const constraints = { video: { facingMode: "environment" } };
  navigator.mediaDevices.getUserMedia(constraints)
    .then(stream => {
      const video = document.createElement('video');
      video.id = 'camera';
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = stream;
      video.style.width = '100%';
      video.style.height = 'calc(100vh - 180px)';
      video.style.objectFit = 'contain';
      video.style.borderRadius = '12px';

      const container = document.getElementById('video-container');
      container.innerHTML = '';
      container.appendChild(video);
      cameraInput = video;

      const scanButton = document.getElementById('scan-button');
      const galleryButton = document.getElementById('gallery-button');
      const galleryInput = document.getElementById('gallery-input');
      const editButton = document.getElementById('edit-button');
      const saveButton = document.getElementById('save-button');

      if (scanButton) scanButton.onclick = captureImage;
      if (galleryButton) galleryButton.onclick = () => galleryInput.click();
      if (galleryInput) galleryInput.onchange = e => {
        const file = e.target.files[0];
        if (file) processGalleryImage(file);
      };
      if (editButton) editButton.onclick = enableEditing;
      if (saveButton) saveButton.onclick = saveChanges;
    })
    .catch(err => console.error('camera err', err));
}

// 📊 Update Progress Bars + Premium Card
function updateUsageUI() {
  const scanProgress = document.getElementById('scan-progress');
  const aiProgress = document.getElementById('ai-progress');
  const scanText = document.getElementById('scan-text');
  const aiText = document.getElementById('ai-text');
  const premiumSection = document.querySelector('.premium-section');

  const maxScans = 5;
  const maxAI = 5;

  if (scanProgress) {
    scanProgress.value = scanCount;
    scanProgress.max = maxScans;
  }
  if (aiProgress) {
    aiProgress.value = analysisCount;
    aiProgress.max = maxAI;
  }
  if (scanText) scanText.textContent = `${scanCount}/${maxScans} Scans Today`;
  if (aiText) aiText.textContent = `${analysisCount}/${maxAI} AI Analyses Today`;

  if (premiumSection) {
    premiumSection.style.display = currentUserPlan === 'premium' ? 'none' : 'block';
  }

  const usageText = document.getElementById('usage-text');
  const progressBar = document.getElementById('usage-progress');
  if (usageText && progressBar) {
    const totalUsed = scanCount + analysisCount;
    const totalLimit = currentUserPlan === 'premium' ? 1 : (maxScans + maxAI);
    const percent = currentUserPlan === 'premium' ? 100 : Math.min((totalUsed / totalLimit) * 100, 100);
    progressBar.style.width = percent + '%';
    progressBar.style.background = percent >= 100 ? '#ff4d4d' : '#00c6ff';
    usageText.textContent =
      currentUserPlan === 'premium'
        ? 'Unlimited access for Premium users 🏆'
        : `Used ${totalUsed}/${totalLimit} actions today`;
  }
}

// 🧠 Limit Check
async function checkScanLimit(type = 'scan') {
  const user = auth.currentUser;
  if (!user) {
    Swal.fire({
      icon: 'info',
      title: 'Login Required 🔐',
      text: 'Please log in to use Clarivana’s scanning features.',
      confirmButtonText: 'Got it',
      customClass: { popup: 'swal-account' }
    });
    return false;
  }

  const docRef = db.collection('users').doc(user.uid);
  const docSnap = await docRef.get();
  const today = new Date().toISOString().split('T')[0];
  let data = docSnap.exists ? docSnap.data() : null;

  if (!data) {
    await docRef.set({
      plan: 'free',
      scansToday: 0,
      analysisToday: 0,
      lastScanDate: today
    });
    data = { plan: 'free', scansToday: 0, analysisToday: 0, lastScanDate: today };
  }

  if (data.lastScanDate !== today) {
    await docRef.update({ scansToday: 0, analysisToday: 0, lastScanDate: today });
    data.scansToday = 0;
    data.analysisToday = 0;
  }

  const maxScans = 8, maxAI = 5;
  if (data.plan === 'free') {
    if (type === 'scan' && data.scansToday >= maxScans) {
      Swal.fire({
        icon: 'info',
        title: 'Daily Scan Limit Reached',
        text: 'Upgrade to Premium for unlimited scans 🚀',
        customClass: { popup: 'swal-info' }
      });
      document.querySelector('.premium-section')?.scrollIntoView({ behavior: 'smooth' });
      return false;
    }
    if (type === 'ai' && data.analysisToday >= maxAI) {
      Swal.fire({
        icon: 'info',
        title: 'Daily AI Analysis Limit Reached',
        text: 'Upgrade to Premium for unlimited analyses 🚀',
        customClass: { popup: 'swal-info' }
      });
      document.querySelector('.premium-section')?.scrollIntoView({ behavior: 'smooth' });
      return false;
    }
  }

  await docRef.update({
    [`${type === 'scan' ? 'scansToday' : 'analysisToday'}`]:
      (type === 'scan' ? data.scansToday : data.analysisToday) + 1,
    lastScanDate: today
  });

  if (type === 'scan') scanCount++;
  else analysisCount++;
  updateUsageUI();
  return true;
}

// 📸 Capture from Camera
async function captureImage() {
  const allowed = await checkScanLimit('scan');
  if (!allowed) return;

  const canvas = document.createElement('canvas');
  canvas.width = cameraInput.videoWidth;
  canvas.height = cameraInput.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(cameraInput, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL();

  document.getElementById('captured-image').innerHTML = `
    <img src="${data}" alt="captured" style="width:100%;max-width:400px;border-radius:8px">
  `;
  extractTextFromImage(canvas);
}

// 🖼️ From Gallery
function processGalleryImage(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const src = e.target.result;
    document.getElementById('captured-image').innerHTML = `
      <img src="${src}" alt="selected" style="width:100%;max-width:400px;border-radius:8px">
    `;
    const img = new Image();
    img.src = src;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      extractTextFromImage(canvas);
    };
  };
  reader.readAsDataURL(file);
}

// 🔍 OCR Text Extraction
async function extractTextFromImage(canvasEl) {
  extractedTextElement.value = 'Recognizing...';
  const allowed = await checkScanLimit('ai');
  if (!allowed) return;

  Tesseract.recognize(canvasEl, 'eng', { logger: m => console.log(m) })
    .then(({ data }) => {
      const text = data.text || '';
      extractedTextElement.value = text;
      checkAllergiesThenHarmful(text);

      const aiBtn = document.getElementById('ai-button');
      const scanAnotherBtn = document.getElementById('scan-another');
      if (aiBtn) aiBtn.style.display = 'inline-block';
      if (scanAnotherBtn) scanAnotherBtn.style.display = 'inline-block';
    })
    .catch(err => {
      console.error('ocr err', err);
      extractedTextElement.value = '';
      Swal.fire({
        icon: 'error',
        title: 'OCR Failed 😢',
        text: 'Please try again.',
        customClass: { popup: 'swal-error' }
      });
    });
}

// 🧾 Allergy & Harmful Ingredient Checks
function checkAllergiesThenHarmful(extractedText) {
  const textLower = extractedText.toLowerCase();
  auth.onAuthStateChanged(async (user) => {
    let allergyAlerts = [];
    if (user) {
      const doc = await db.collection('users').doc(user.uid).get();
      if (doc.exists) {
        const allergies = doc.data().allergies || [];
        allergyAlerts = allergies.filter(a => a && textLower.includes(a.toLowerCase()));
      }
    }
    if (allergyAlerts.length > 0) {
      Swal.fire({
        icon: 'warning',
        title: '⚠️ Allergy Alert!',
        text: `Contains: ${allergyAlerts.join(', ')}`,
        customClass: { popup: 'swal-error' }
      }).then(() => detectHarmfulIngredients(extractedText, allergyAlerts));
    } else detectHarmfulIngredients(extractedText, allergyAlerts);
  });
}

// ⚡ Clarivana — Precise JSON-aware ingredient detection
async function detectHarmfulIngredients(extractedText, allergyAlerts = []) {
  if (!extractedText || !extractedText.trim()) {
    // no text → nothing to do
    return saveScanResult(extractedText, allergyAlerts, []); 
  }

  // Normalize the OCR text
  const normalize = s => s
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[\u2010-\u2015]/g, '-') // different hyphens
    .replace(/[^a-z0-9\s\-\_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const text = normalize(extractedText);

  // Accept either: harmfulIngredientsData is the array, or an object with harmfulIngredients
  const harmfulList = Array.isArray(harmfulIngredientsData)
    ? harmfulIngredientsData
    : (harmfulIngredientsData && harmfulIngredientsData.harmfulIngredients) || [];

  // Helper: escape regex for literal phrase matching
  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Conservative Levenshtein (used only rarely)
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + cost);
      }
    }
    return dp[m][n];
  }

  // Conservative fuzzy: only allow very small ratio for long words
  function conservativeFuzzyMatch(a, b) {
    const A = a.replace(/\s+/g,'').toLowerCase();
    const B = b.replace(/\s+/g,'').toLowerCase();
    const maxLen = Math.max(A.length, B.length);
    if (maxLen < 6) return false;           // don't fuzzy-match short tokens
    const dist = levenshtein(A, B);
    const ratio = dist / maxLen;
    return ratio <= 0.15;                   // strict threshold
  }

  // Build tokens set from scanned text for quick lookup
  const tokens = new Set(text.split(/\s+/).filter(Boolean));

  // helper: test if phrase appears as whole words (supports 'yellow 5', 'e330', 'ascorbic acid')
  function hasWholePhrase(phrase) {
    if (!phrase || !phrase.trim()) return false;
    const p = normalize(phrase);
    // If phrase includes digits (e.g., 'yellow 5' or 'e330'), accept either 'yellow 5', 'yellow-5', 'yellow5'
    const hasDigit = /[0-9]/.test(p);
    if (hasDigit) {
      const variants = [
        p,
        p.replace(/\s+/g,''),
        p.replace(/\s+/g,'-'),
        p.replace(/[-_]+/g,' ')
      ];
      for (const v of variants) {
        const rx = new RegExp(`\\b${escapeRegex(v)}\\b`, 'i');
        if (rx.test(text)) return true;
      }
      return false;
    }
    // multi-word phrase: use word-boundary phrase search
    const rx = new RegExp(`\\b${escapeRegex(p)}\\b`, 'i');
    if (rx.test(text)) return true;
    // As extra precaution: check if all words of the phrase appear together in same order (handles minor punctuation differences)
    const parts = p.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      let idx = -1;
      let startPos = 0;
      for (const part of parts) {
        const rxPart = new RegExp(`\\b${escapeRegex(part)}\\b`, 'i');
        const m = rxPart.exec(text.slice(startPos));
        if (!m) { idx = -1; break; }
        startPos += m.index + part.length;
        idx++;
      }
      if (idx === parts.length - 1) return true;
    }
    // single-word fallback: check exact token match
    if (parts.length === 1) {
      return tokens.has(parts[0]);
    }
    return false;
  }

  // blacklist of generic words to avoid accidental matching (e.g. 'yellow' alone shouldn't trigger 'yellow_5')
  const genericBlacklist = new Set([
    'yellow','red','blue','white','black','green','natural','artificial','flavour','flavor','colour','color',
    'corn','meal','malted','barley','flour','water','sugar','salt','oil','extract','natural'
  ]);

  const foundIngredients = []; // will store full objects
  const foundIds = new Set();

  // Precompute normalized candidate strings for each ingredient to speed up checks
  for (const ingredient of harmfulList) {
    if (!ingredient || !ingredient.name) continue;

    const candidates = new Set();

    // push canonical forms
    candidates.add(ingredient.name);
    candidates.add(ingredient.id);
    (ingredient.aliases || []).forEach(a => candidates.add(a));

    // also push lower & normalized forms
    const candArr = Array.from(candidates).map(c => normalize(String(c)));

    let matched = false;

    // 1) Check exact/whole-phrase matches first (strict)
    for (const c of candArr) {
      if (!c) continue;
      // skip very generic single words unless they are the only candidate and also include numeric or special char
      if (c.split(/\s+/).length === 1 && genericBlacklist.has(c)) {
        // but if alias/id contains digits (e.g., 'yellow 5' or 'e330') then we shouldn't skip
        if (!/[0-9]/.test(c) && !ingredient.id.match(/[0-9]/)) {
          continue;
        }
      }
      if (hasWholePhrase(c)) {
        matched = true;
        break;
      }
    }

    // 2) If not matched, consider conservative fuzzy only for long candidates
    if (!matched) {
      for (const c of candArr) {
        if (!c) continue;
        // avoid fuzzy for short tokens
        if (c.replace(/\s+/g,'').length < 6) continue;
        // quick containment check: if many letters overlap, run conservativeFuzzyMatch
        if (conservativeFuzzyMatch(c, text)) {
          // final safety: ensure the match isn't actually a small substring inside a bigger word found in the OCR
          // (we already removed many punctuation chars; still, double-check tokens)
          const maybe = c.split(/\s+/).map(p => tokens.has(p)).filter(Boolean);
          // require at least one token to match exactly as token or phrase heuristic already matched; if none → skip
          if (maybe.length > 0) {
            matched = true;
            break;
          }
        }
      }
    }

    if (matched) {
      if (!foundIds.has(ingredient.id)) {
        foundIds.add(ingredient.id);
        foundIngredients.push(ingredient);
      }
    }
  }

  // Build result UI & save
  if (foundIngredients.length > 0) {
    const html = foundIngredients.map(ing => {
      const riskColor = ing.riskLevel === 'High' ? '#ff6b6b' : (ing.riskLevel === 'Moderate' ? '#ffd166' : '#8af78a');
      const toxAc = (ing.toxicity && ing.toxicity.acute) ? ing.toxicity.acute : 'N/A';
      const toxCh = (ing.toxicity && ing.toxicity.chronic) ? ing.toxicity.chronic : 'N/A';
      const regs = ing.regulatoryStatus ? Object.entries(ing.regulatoryStatus).map(([k,v]) => `<b>${k}:</b> ${v}`).join('<br>') : '';
      const effects = (ing.healthEffects || []).map(h => `<li>${h.effect}</li>`).join('');
      const refs = (ing.references || []).map(r => `<li><a href="${r}" target="_blank" rel="noopener" style="color:#a9d6ff">${r}</a></li>`).join('');
      return `
        <div style="text-align:left;padding:12px;margin:8px 0;border-radius:10px;background:#0f1720;border:1px solid rgba(255,255,255,0.03)">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <strong style="color:#fff;font-size:1.05em">${ing.name}</strong>
              <div style="color:#9db6c9;font-size:0.85em">${ing.category} • <span style="color:${riskColor}">${ing.riskLevel}</span></div>
            </div>
            <div style="text-align:right;color:#c9d8ff;font-size:0.8em">${ing.id}</div>
          </div>
          <p style="color:#cbd5e1;margin-top:10px">${ing.description || ''}</p>
          <div style="display:flex;gap:12px;font-size:0.88em;color:#d2e7ff">
            <div><b>Toxicity</b><br>Acute: ${toxAc}<br>Chronic: ${toxCh}</div>
            <div><b>Regulatory</b><br>${regs}</div>
          </div>
          ${effects ? `<div style="margin-top:8px;"><b style="color:#e6f7ff">Health effects</b><ul style="color:#a7c7df;margin:6px 0 0 16px">${effects}</ul></div>` : ''}
          ${refs ? `<div style="margin-top:8px;"><b style="color:#e6f7ff">References</b><ul style="color:#a7c7df;margin:6px 0 0 16px">${refs}</ul></div>` : ''}
        </div>
      `;
    }).join('');

    // Save scan result with the found ids array
    await saveScanResult(extractedText, allergyAlerts, Array.from(foundIds));

    await Swal.fire({
      icon: 'warning',
      title: `⚠️ ${foundIngredients.length} harmful item${foundIngredients.length>1?'s':''} detected`,
      html,
      width: '720px',
      background: '#071122',
      color: '#e6f7ff',
      showCancelButton: true,
      confirmButtonText: 'Understood',
      cancelButtonText: 'Scan Another',
      confirmButtonColor: '#ff6b6b',
      cancelButtonColor: '#2b2f36',
      customClass: { popup: 'swal-harmful' },
      didClose: () => { if (window.appLoadHistory) window.appLoadHistory(); }
    }).then(result => {
      if (result.dismiss === Swal.DismissReason.cancel) {
        // reset scan session without full reload
        try { resetScanSession(); } catch(e){ location.reload(); }
      }
    });

  } else {
    // No harmful ingredients found — save and show all-clear
    await saveScanResult(extractedText, allergyAlerts, []);
    await Swal.fire({
      icon: 'success',
      title: '✨ All Clear',
      text: 'No harmful ingredients detected in this scan.',
      background: '#071122',
      color: '#e6f7ff',
      confirmButtonColor: '#2ecc71',
      confirmButtonText: 'Nice'
    });
  }
}




// 💾 Save Result
async function saveScanResult(extractedText, allergyAlerts, foundArr) {
  const user = auth.currentUser;
  const doc = {
    timestamp: firebase.firestore.FieldValue.serverTimestamp ? firebase.firestore.FieldValue.serverTimestamp() : Date.now(),
    ingredients: extractedText.slice(0, 2000),
    allergiesFound: allergyAlerts,
    harmfulNotes: foundArr
  };
  try {
    if (user) {
      await db.collection('users').doc(user.uid).collection('history').add(doc);
    } else {
      const arr = JSON.parse(localStorage.getItem('localHistory') || '[]');
      arr.unshift(doc);
      localStorage.setItem('localHistory', JSON.stringify(arr.slice(0, 50)));
    }
  } catch (err) {
    console.error('saveScan err', err);
  }
}

// ✏️ Edit Text
function enableEditing() {
  const ta = document.getElementById('extracted-text');
  ta.readOnly = false;
  document.getElementById('edit-button').style.display = 'none';
  document.getElementById('save-button').style.display = 'inline';
}

function saveChanges() {
  const ta = document.getElementById('extracted-text');
  const edited = ta.value;
  ta.readOnly = true;
  document.getElementById('edit-button').style.display = 'inline';
  document.getElementById('save-button').style.display = 'none';
  checkAllergiesThenHarmful(edited);
}

// 🧹 Reset Scan Session with fade animation
function resetScanSession() {
  const scanSection = document.getElementById('scanner-screen');
  const videoContainer = document.getElementById('video-container');
  const capturedImage = document.getElementById('captured-image');
  const extractedText = document.getElementById('extracted-text');
  const aiResult = document.getElementById('ai-result');
  const scanAnother = document.getElementById('scan-another');
  const aiBtn = document.getElementById('ai-button');
  const editBtn = document.getElementById('edit-button');
  const saveBtn = document.getElementById('save-button');

  // 🎬 Fade out old content
  scanSection.classList.add('fade-out');

  setTimeout(() => {
    // Clear old data
    capturedImage.innerHTML = '';
    extractedText.value = '';
    if (aiResult) aiResult.style.display = 'none';

    scanAnother.style.display = 'none';
    aiBtn.style.display = 'none';
    editBtn.style.display = 'inline';
    saveBtn.style.display = 'none';

    // Restart camera after fade
    startCamera();

    // 🎬 Fade in new session
    scanSection.classList.remove('fade-out');
    scanSection.classList.add('fade-in');

    Swal.fire({
      icon: 'info',
      title: '✨ New Scan Ready',
      text: 'Your scanner has been refreshed.',
      background: 'radial-gradient(circle at top left, #0d121a, #151e28)',
      color: '#b5e9ff',
      showConfirmButton: false,
      timer: 1600,
      customClass: { popup: 'swal-scan' }
    });

    setTimeout(() => {
      scanSection.classList.remove('fade-in');
    }, 800);
  }, 500);
}


// 🧠 AI Analysis Integration
async function runAIAnalysis() {
  const allowed = await checkScanLimit('ai');
  if (!allowed) return;

  const text = extractedTextElement.value.trim();
  if (!text) {
    Swal.fire({
      icon: 'info',
      title: 'No Ingredients Found!',
      text: 'Please scan first.',
      customClass: { popup: 'swal-info' }
    });
    return;
  }

  const aiBtn = document.getElementById('ai-button');
  aiBtn.textContent = "Analyzing...";
  aiBtn.disabled = true;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: `Given these ingredients:\n${text}\nSuggest safer or healthier alternatives for each ingredient and briefly explain why they're better.`
          }]
        }]
      })
    });

    const data = await res.json();
    const aiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "No AI analysis result.";
    Swal.fire({
      icon: 'info',
      title: 'AI Ingredient Analysis 🧠',
      html: `<div style="text-align:left;white-space:pre-wrap">${aiText}</div>`,
      customClass: { popup: 'swal-account' }
    });
  } catch (err) {
    console.error('AI Error', err);
    Swal.fire({
      icon: 'error',
      title: 'AI Analysis Failed 😔',
      text: 'Try again later.',
      customClass: { popup: 'swal-error' }
    });
  } finally {
    aiBtn.textContent = "AI Analysis";
    aiBtn.disabled = false;
  }
}

// 🧠 Auto Camera Init + Premium Upgrade Button
document.addEventListener('DOMContentLoaded', () => {
  const navScanner = document.getElementById('nav-scanner');
  const goScanner = document.getElementById('go-scanner');
  const aiBtn = document.getElementById('ai-button');
  const scanAnotherBtn = document.getElementById('scan-another');

  if (aiBtn) aiBtn.addEventListener('click', runAIAnalysis);
  if (scanAnotherBtn) scanAnotherBtn.addEventListener('click', resetScanSession);

  function ensureStartCamera() {
    if (!cameraInput) startCamera();
  }
  navScanner && navScanner.addEventListener('click', ensureStartCamera);
  goScanner && goScanner.addEventListener('click', ensureStartCamera);
  const sc = document.getElementById('scanner-screen');
  if (sc && sc.style.display !== 'none') ensureStartCamera();

  updateUsageUI();
});
