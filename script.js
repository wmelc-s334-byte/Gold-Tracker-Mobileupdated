const STORAGE_KEY = "goldTrackJournal_v1";
const $ = (id) => document.getElementById(id);

let data = loadData();
let currentTab = "all";
let selectedFoodNutrition = null;
const FDC_KEY_STORAGE = "goldTrackFdcApiKey_v1";
const USDA_DEMO_KEY = "DEMO_KEY";

function loadData() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.workouts) && Array.isArray(saved.food)) return { workouts: saved.workouts, food: saved.food, water: Array.isArray(saved.water) ? saved.water : [] };
  } catch (error) {}
  return { workouts: [], food: [], water: [] };
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

$("workoutDate").value = todayISO();
$("foodDate").value = todayISO();
$("waterDate").value = todayISO();
$("calendarMonth").value = todayISO().slice(0, 7);
if ($("fdcApiKey")) $("fdcApiKey").value = localStorage.getItem(FDC_KEY_STORAGE) || "";
$("todayLabel").textContent = new Date().toLocaleDateString(undefined, {
  weekday: "long", month: "long", day: "numeric"
}).toUpperCase();

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
}

$("workoutForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    type: "workout",
    exercise: $("exercise").value.trim(),
    date: $("workoutDate").value,
    sets: Number($("sets").value),
    reps: Number($("reps").value),
    load: $("load").value === "" ? null : Number($("load").value),
    effort: $("effort").value,
    notes: $("workoutNotes").value.trim(),
    createdAt: Date.now()
  };

  if (!entry.exercise || !entry.date || entry.sets < 1 || entry.reps < 1) return;
  data.workouts.push(entry);
  saveData();
  $("workoutForm").reset();
  $("workoutDate").value = todayISO();
  $("sets").value = 3;
  $("reps").value = 8;
  render();
  toast("Workout entry saved!");
});


function getNutrient(food, nutrientNumbers, nameFallback) {
  const nutrients = food.foodNutrients || [];
  const found = nutrients.find(n => nutrientNumbers.includes(String(n.nutrientNumber || n.number || "")) ||
    nutrientNumbers.includes(String(n.nutrientId || "")) ||
    (nameFallback && String(n.nutrientName || n.name || "").toLowerCase().includes(nameFallback)));
  if (!found) return 0;
  let value = Number(found.value ?? found.amount ?? 0);
  const unit = String(found.unitName || found.unit || "").toLowerCase();
  if (nameFallback === "energy" && unit === "kj") value = value / 4.184;
  return Number.isFinite(value) ? value : 0;
}

function nutritionFromSearchResult(food) {
  return {
    calories: getNutrient(food, ["208", "1008"], "energy"),
    protein: getNutrient(food, ["203", "1003"], "protein"),
    carbs: getNutrient(food, ["205", "1005"], "carbohydrate"),
    fat: getNutrient(food, ["204", "1004"], "total lipid"),
    fiber: getNutrient(food, ["291", "1079"], "fiber"),
    basis: "100g"
  };
}

function setFoodSearchStatus(message, isError = false) {
  const el = $("foodSearchStatus");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error-text", isError);
}


function normalizedFood({description, brandOwner="", dataType="Open Food Facts", calories=0, protein=0, carbs=0, fat=0, fiber=0, source="", barcode="", serving="", servingGrams=null, nutritionBasis="100g", raw=null}) {
  return {
    description, brandOwner, dataType, source, barcode, serving, servingGrams, nutritionBasis, raw,
    foodNutrients: [
      {nutrientNumber:"208", value:Number(calories)||0, unitName:"kcal", nutrientName:"Energy"},
      {nutrientNumber:"203", value:Number(protein)||0, unitName:"g", nutrientName:"Protein"},
      {nutrientNumber:"205", value:Number(carbs)||0, unitName:"g", nutrientName:"Carbohydrate"},
      {nutrientNumber:"204", value:Number(fat)||0, unitName:"g", nutrientName:"Total lipid (fat)"},
      {nutrientNumber:"291", value:Number(fiber)||0, unitName:"g", nutrientName:"Fiber"}
    ]
  };
}
function fromOffProduct(p) {
  const n=p.nutriments||{};
  const kcal=n["energy-kcal_100g"] ?? (Number(n.energy_100g||0)/4.184);
  const brand=String(p.brands||"").split(",")[0].trim();
  const name=String(p.product_name||p.product_name_en||"").trim();
  return normalizedFood({
    description:[brand,name].filter(Boolean).join(" ") || "Packaged food",
    brandOwner:brand, dataType:"Open Food Facts · packaged product",
    calories:kcal, protein:n.proteins_100g, carbs:n.carbohydrates_100g,
    fat:n.fat_100g, fiber:n.fiber_100g, source:"Open Food Facts",
    barcode:p.code||"", serving:p.serving_size||"",
    servingGrams:(()=>{const m=String(p.serving_size||"").match(/([\d.]+)\s*g\b/i);return m?Number(m[1]):null;})(), raw:p
  });
}
function fromFdcFood(food) {
  const n=nutritionFromSearchResult(food);
  const branded=String(food.dataType||"").toLowerCase()==="branded";
  const unit=String(food.servingSizeUnit||"").toLowerCase();
  const servingGrams=unit==="g"||unit==="gram"||unit==="grams" ? Number(food.servingSize)||null :
    (unit==="oz"||unit==="ounce"||unit==="ounces" ? (Number(food.servingSize)||0)*28.3495||null :
    (unit==="ml"||unit==="milliliter"||unit==="milliliters" ? Number(food.servingSize)||null : null));
  const hasGramBasis=!branded||servingGrams>0;
  const scale=branded&&servingGrams>0?100/servingGrams:1;
  return normalizedFood({
    description:food.description, brandOwner:food.brandOwner||food.brandName||"",
    dataType:food.dataType||"USDA FoodData Central",
    calories:n.calories*scale, protein:n.protein*scale, carbs:n.carbs*scale, fat:n.fat*scale,
    fiber:n.fiber*scale, source:"USDA FoodData Central",
    serving:food.servingSize?`${food.servingSize} ${food.servingSizeUnit||""}`.trim():"",servingGrams,
    nutritionBasis:hasGramBasis?"100g":"serving",raw:food
  });
}
function renderFoodResults(results) {
  const unique=new Map();
  results.forEach(food=>{
    const key=(food.description+"|"+food.barcode).toLowerCase();
    if(!unique.has(key)) unique.set(key,food);
  });
  const foods=[...unique.values()].slice(0,45);
  if(!foods.length) {
    $("foodSearchResults").innerHTML="";
    setFoodSearchStatus("No matching products found. Try a shorter name, brand name, alternate spelling, or barcode.");
    return;
  }
  $("foodSearchResults").innerHTML=foods.map((food,index)=>{
    const n=nutritionFromSearchResult(food);
    const brand=food.brandOwner?` · ${safeText(food.brandOwner)}`:"";
    const serving=food.serving?` · serving ${safeText(food.serving)}`:"";
    return `<div class="food-result">
      <div><strong>${safeText(food.description)}</strong><div class="food-result-meta"><small>${safeText(food.dataType)}${brand}${serving} · nutrition ${food.nutritionBasis==="serving"?"per labeled serving":"per 100 g"}</small></div>
      <div class="food-result-meta"><small>P ${n.protein.toFixed(1)}g · C ${n.carbs.toFixed(1)}g · F ${n.fat.toFixed(1)}g · Fiber ${n.fiber.toFixed(1)}g</small></div></div>
      <div class="food-result-kcal">${Math.round(n.calories)} kcal</div>
      <button class="text-button" type="button" data-food-result="${index}">＋ Add food</button>
    </div>`;
  }).join("");
  $("foodSearchResults")._foods=foods;
  $("foodSearchResults").querySelectorAll("[data-food-result]").forEach(button=>{
    button.addEventListener("click",()=>{
      const food=$("foodSearchResults")._foods[Number(button.dataset.foodResult)];
      if(food) selectDatabaseFood(food);
    });
  });
  setFoodSearchStatus(`${foods.length} matching foods/products. Sources: USDA FoodData Central + Open Food Facts. Branded entries are matched by product/brand where available.`);
}
async function searchUSDA(query) {
  const key=localStorage.getItem(FDC_KEY_STORAGE)||USDA_DEMO_KEY;
  const response=await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({query,pageSize:25,dataType:["Branded","Foundation","SR Legacy","Survey (FNDDS)"]})
  });
  if(!response.ok) throw new Error(`USDA ${response.status}`);
  const payload=await response.json();
  return (payload.foods||[]).filter(f=>f.description).map(fromFdcFood);
}
async function searchOpenFoodFacts(query) {
  const url=`https://world.openfoodfacts.org/cgi/search.pl?${new URLSearchParams({
    search_terms:query,search_simple:"1",action:"process",json:"1",page_size:"30",
    fields:"code,product_name,product_name_en,brands,serving_size,nutriments"
  })}`;
  const response=await fetch(url,{headers:{"Accept":"application/json"}});
  if(!response.ok) throw new Error(`Open Food Facts ${response.status}`);
  const payload=await response.json();
  return (payload.products||[]).filter(p=>p.product_name||p.product_name_en).map(fromOffProduct);
}
async function searchFoodDatabase() {
  const query=$("foodSearchInput").value.trim();
  if(/^\d{8,14}$/.test(query)){ $("foodBarcodeInput").value=query; await lookupBarcode(query); return; }
  if(query.length<2){setFoodSearchStatus("Enter at least 2 letters, or use barcode lookup.");return;}
  const btn=$("foodSearchBtn");btn.disabled=true;btn.textContent="Searching…";
  $("foodSearchResults").innerHTML="";
  setFoodSearchStatus("Searching USDA Branded Foods and Open Food Facts in parallel…");
  const tasks=await Promise.allSettled([searchUSDA(query),searchOpenFoodFacts(query)]);
  const results=tasks.flatMap(t=>t.status==="fulfilled"?t.value:[]);
  const errors=tasks.filter(t=>t.status==="rejected").map(t=>t.reason?.message||"source unavailable");
  renderFoodResults(results);
  if(!results.length) setFoodSearchStatus(`No results returned. ${errors.join("; ")||"Check your connection and try again."}`,true);
  else if(errors.length) setFoodSearchStatus(`${results.length} results loaded. Some sources were unavailable (${errors.join("; ")}); try again later for broader matches.`);
  btn.disabled=false;btn.textContent="Search all";
}
async function lookupBarcode(code) {
  const clean=String(code||"").replace(/\D/g,"");
  if(clean.length<8){setFoodSearchStatus("Enter a valid UPC/EAN barcode (at least 8 digits).",true);return;}
  setFoodSearchStatus("Looking up barcode in Open Food Facts…");
  $("barcodeLookupBtn").disabled=true;
  try{
    const response=await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(clean)}.json?fields=code,product_name,product_name_en,brands,serving_size,nutriments`);
    if(!response.ok) throw new Error(`Barcode service returned ${response.status}`);
    const payload=await response.json();
    if(payload.status!==1||!payload.product) throw new Error("No product found for that barcode.");
    const food=fromOffProduct(payload.product);
    renderFoodResults([food]);
    setFoodSearchStatus(`Barcode matched: ${food.description}. Confirm the package and serving information before logging.`);
  }catch(error){setFoodSearchStatus(error.message||"Barcode lookup failed.",true);}
  finally{$("barcodeLookupBtn").disabled=false;}
}
$("barcodeLookupBtn").addEventListener("click",()=>lookupBarcode($("foodBarcodeInput").value));
$("foodBarcodeInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();lookupBarcode(e.target.value);}});
let barcodeStream=null, barcodeFrame=0;
async function startBarcodeScanner(){
  if(!("BarcodeDetector" in window)){setFoodSearchStatus("Camera barcode scanning is not supported in this browser. Enter the UPC/EAN number above instead.",true);return;}
  try{
    const detector=new BarcodeDetector({formats:["ean_13","ean_8","upc_a","upc_e"]});
    barcodeStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"},audio:false});
    const video=$("barcodeVideo");video.hidden=false;video.srcObject=barcodeStream;await video.play();
    $("barcodeScanBtn").textContent="Stop camera";
    const scan=async()=>{
      if(!barcodeStream)return;
      try{const codes=await detector.detect(video);if(codes.length){$("foodBarcodeInput").value=codes[0].rawValue;stopBarcodeScanner();lookupBarcode(codes[0].rawValue);return;}}catch(e){}
      barcodeFrame=requestAnimationFrame(scan);
    };scan();
  }catch(error){stopBarcodeScanner();setFoodSearchStatus("Camera unavailable. Allow camera access or enter the barcode manually.",true);}
}
function stopBarcodeScanner(){
  if(barcodeFrame)cancelAnimationFrame(barcodeFrame);
  if(barcodeStream)barcodeStream.getTracks().forEach(t=>t.stop());
  barcodeStream=null;$("barcodeVideo").hidden=true;$("barcodeVideo").srcObject=null;
  $("barcodeScanBtn").textContent="Use camera";
}
$("barcodeScanBtn").addEventListener("click",()=>barcodeStream?stopBarcodeScanner():startBarcodeScanner());
function selectDatabaseFood(food) {
  selectedFoodNutrition = {...nutritionFromSearchResult(food), servingGrams:food.servingGrams||null, nutritionBasis:food.nutritionBasis||"100g"};
  $("foodName").value = food.description || "";
  if (food.barcode) $("foodNotes").value = `Barcode: ${food.barcode}${food.source ? " · " + food.source : ""}`;
  $("foodAmount").value = food.servingGrams || food.nutritionBasis==="serving" ? "1" : "100";
  $("foodUnit").value = food.servingGrams || food.nutritionBasis==="serving" ? "servings" : "grams";
  applySelectedFoodPortion();
  $("foodName").focus();
  setFoodSearchStatus(`Added ${food.description}. Adjust the portion amount in grams or ounces; calories and macros recalculate automatically.`);
  $("foodForm").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function applySelectedFoodPortion() {
  if (!selectedFoodNutrition) return;
  const amount = Number($("foodAmount").value);
  if (!Number.isFinite(amount) || amount < 0) return;
  const unit = $("foodUnit").value;
  let grams;
  if (selectedFoodNutrition.nutritionBasis==="serving") {
    if(unit!=="servings"){setFoodSearchStatus("This branded record only provides nutrients per labeled serving. Keep the unit as servings for accurate scaling.");return;}
    grams=amount*100;
  } else if (unit === "grams") grams = amount;
  else if (unit === "ounces") grams = amount * 28.3495;
  else if (unit === "servings" && selectedFoodNutrition.servingGrams) grams = amount * selectedFoodNutrition.servingGrams;
  else {
    setFoodSearchStatus("This food has no verified gram weight for that unit. Choose grams or ounces, or use a product with serving-size data.");
    return;
  }
  const factor = grams / 100;
  $("foodCalories").value = (selectedFoodNutrition.calories * factor).toFixed(1);
  $("foodProtein").value = (selectedFoodNutrition.protein * factor).toFixed(1);
  $("foodCarbs").value = (selectedFoodNutrition.carbs * factor).toFixed(1);
  $("foodFat").value = (selectedFoodNutrition.fat * factor).toFixed(1);
  $("foodFiber").value = (selectedFoodNutrition.fiber * factor).toFixed(1);
}

$("foodSearchBtn").addEventListener("click", searchFoodDatabase);
$("foodSearchInput").addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); searchFoodDatabase(); }
});
$("foodName").addEventListener("input", () => { selectedFoodNutrition = null; });
$("foodAmount").addEventListener("input", applySelectedFoodPortion);
$("foodUnit").addEventListener("change", applySelectedFoodPortion);
$("saveApiKeyBtn").addEventListener("click", () => {
  const key = $("fdcApiKey").value.trim();
  if (key) localStorage.setItem(FDC_KEY_STORAGE, key);
  else localStorage.removeItem(FDC_KEY_STORAGE);
  toast(key ? "USDA API key saved on this device." : "Using USDA demo access.");
});

$("foodForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    type: "food",
    meal: $("mealType").value,
    name: $("foodName").value.trim(),
    date: $("foodDate").value,
    feeling: $("foodFeeling").value,
    amount: $("foodAmount").value === "" ? null : Number($("foodAmount").value),
    unit: $("foodUnit").value,
    group: $("foodGroup").value,
    protein: $("foodProtein").value === "" ? null : Number($("foodProtein").value),
    carbs: $("foodCarbs").value === "" ? null : Number($("foodCarbs").value),
    fat: $("foodFat").value === "" ? null : Number($("foodFat").value),
    calories: $("foodCalories").value === "" ? null : Number($("foodCalories").value),
    fiber: $("foodFiber").value === "" ? null : Number($("foodFiber").value),
    micros: $("foodMicros").value.trim(),
    notes: $("foodNotes").value.trim(),
    createdAt: Date.now()
  };
  if (!entry.name || !entry.date) return;
  data.food.push(entry);
  saveData();
  $("foodForm").reset();
  selectedFoodNutrition = null;
  $("foodDate").value = todayISO();
$("waterDate").value = todayISO();
$("calendarMonth").value = todayISO().slice(0, 7);
  render();
  toast("Food journal entry saved!");
});


$("waterForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    type: "water",
    amount: Number($("waterAmount").value),
    unit: $("waterUnit").value,
    date: $("waterDate").value,
    createdAt: Date.now()
  };
  if (!entry.amount || entry.amount < 1 || !entry.date) return;
  data.water = data.water || [];
  data.water.push(entry);
  saveData();
  $("waterForm").reset();
  $("waterDate").value = todayISO();
  render();
  toast("Water entry saved!");
});

function renderCalories() {
  const selectedDate = $("foodDate").value || todayISO();
  const entries = data.food.filter(x => x.date === selectedDate && x.calories != null && Number.isFinite(Number(x.calories)));
  const total = entries.reduce((sum, x) => sum + Number(x.calories), 0);
  $("dailyCalories").textContent = Math.round(total).toLocaleString();
  $("calorieDateLabel").textContent = selectedDate === todayISO() ? "today" : selectedDate;
}

$("foodDate").addEventListener("change", renderCalories);

function renderWater() {
  const entries = (data.water || []).filter(x => x.date === todayISO());
  if (!entries.length) {
    $("waterSummary").textContent = "No water entries yet today.";
    return;
  }
  const totalMl = entries.reduce((sum, x) => sum + x.amount * (x.unit === "oz" ? 29.5735 : x.unit === "cups" ? 236.588 : 1), 0);
  $("waterSummary").innerHTML = `<strong>${entries.length}</strong> water entries logged today <span>·</span> ${Math.round(totalMl)} mL recorded`;
}

function renderRecords() {
  const best = new Map();
  data.workouts.filter(w => w.load !== null && Number.isFinite(Number(w.load))).forEach(w => {
    const key = w.exercise.toLowerCase();
    const prev = best.get(key);
    if (!prev || Number(w.load) > Number(prev.load)) best.set(key, w);
  });
  const rows = [...best.values()].sort((a,b) => a.exercise.localeCompare(b.exercise));
  $("recordList").innerHTML = rows.length ? rows.map(w => `
    <div class="record-item"><strong>${safeText(w.exercise)}</strong><span>${safeText(w.load)} lb</span><small>Best logged · ${safeText(w.date)}</small></div>
  `).join("") : '<p class="empty-state">Log workouts with weights to see your milestones here.</p>';
}

function renderCalendar() {
  const value = $("calendarMonth").value || todayISO().slice(0,7);
  const [year, month] = value.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const active = new Map();
  [...data.workouts.map(x => [x.date, "workout"]), ...data.food.map(x => [x.date, "food"]), ...(data.water || []).map(x => [x.date, "water"])].forEach(([date, kind]) => {
    active.set(date, [...(active.get(date) || []), kind]);
  });
  const names = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  $("calendarGrid").innerHTML = names.map(n => `<div class="calendar-day-name">${n}</div>`).join("");
  for (let i=0;i<startDay;i++) $("calendarGrid").innerHTML += '<div class="calendar-day blank"></div>';
  for (let day=1; day<=daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const kinds = active.get(date) || [];
    $("calendarGrid").innerHTML += `<div class="calendar-day ${kinds.length ? "has-entry" : ""}"><strong>${day}</strong><small>${[...new Set(kinds)].map(k => k === "workout" ? "●" : k === "food" ? "◆" : "○").join(" ")}</small></div>`;
  }
}

$("calendarMonth").addEventListener("change", renderCalendar);

function getAchievements() {
  const workouts = data.workouts;
  const uniqueDays = new Set(workouts.map(w => w.date)).size;
  const uniqueExercises = new Set(workouts.map(w => w.exercise.toLowerCase())).size;
  const achievements = [
    { title: "First Session", desc: "Log your first workout.", icon: "✦", earned: workouts.length >= 1 },
    { title: "Finding Your Rhythm", desc: "Log 5 workout sessions.", icon: "♜", earned: workouts.length >= 5 },
    { title: "Regular Practice", desc: "Log 10 workout sessions.", icon: "⚡", earned: workouts.length >= 10 },
    { title: "Movement Explorer", desc: "Try 5 different exercises.", icon: "◇", earned: uniqueExercises >= 5 },
    { title: "Showed Up", desc: "Be active on 3 different days.", icon: "☀", earned: uniqueDays >= 3 },
    { title: "Food Journal Starter", desc: "Log your first meal.", icon: "◈", earned: data.food.length >= 1 },
    { title: "Food Journal Habit", desc: "Log 10 meals or snacks.", icon: "✧", earned: data.food.length >= 10 }
  ];
  return achievements;
}

function renderStats() {
  $("workoutCount").textContent = data.workouts.length;
  $("exerciseCount").textContent = data.workouts.length;
  $("mealCount").textContent = data.food.length;
  $("achievementCount").textContent = getAchievements().filter(a => a.earned).length;
}

function renderAchievements() {
  $("achievementList").innerHTML = getAchievements().map(a => `
    <div class="achievement ${a.earned ? "" : "locked"}">
      <div class="achievement-icon">${a.earned ? a.icon : "🔒"}</div>
      <div><strong>${safeText(a.title)} ${a.earned ? "✓" : ""}</strong>
      <small>${safeText(a.desc)}</small></div>
    </div>
  `).join("");
}

function renderActivity() {
  const all = [
    ...data.workouts.map(x => ({...x, kind: "workout"})),
    ...data.food.map(x => ({...x, kind: "food"})),
    ...(data.water || []).map(x => ({...x, kind: "water"}))
  ].filter(x => currentTab === "all" || x.kind === currentTab)
   .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  if (!all.length) {
    $("activityList").innerHTML = '<p class="empty-state">No entries yet. Add a workout or food journal entry above.</p>';
    return;
  }

  $("activityList").innerHTML = all.map(item => {
    if (item.kind === "water") {
      return `<div class="activity-item"><div><div class="activity-title">Water · ${safeText(item.amount)} ${safeText(item.unit)}</div><div class="activity-sub">${safeText(item.date)}</div></div><span class="activity-tag">WATER</span></div>`;
    }
    if (item.kind === "workout") {
      const loadText = item.load === null ? "Weight not recorded" : `${item.load} lb used`;
      return `<div class="activity-item">
        <div><div class="activity-title">${safeText(item.exercise)}</div>
        <div class="activity-sub">${safeText(item.date)} · ${item.sets} sets × ${item.reps} reps · ${loadText}</div></div>
        <span class="activity-tag">WORKOUT</span>
      </div>`;
    }
    const portion = item.amount ? ` · ${safeText(item.amount)} ${safeText(item.unit)}` : "";
    const nutrition = [item.calories != null ? `${Math.round(Number(item.calories))} kcal` : "", item.protein != null ? `Protein ${item.protein}g` : "", item.carbs != null ? `Carbs ${item.carbs}g` : "", item.fat != null ? `Fat ${item.fat}g` : "", item.fiber != null ? `Fiber ${item.fiber}g` : ""].filter(Boolean).join(" · ");
    return `<div class="activity-item">
      <div><div class="activity-title">${safeText(item.meal)} · ${safeText(item.name)}${portion}</div>
      <div class="activity-sub">${safeText(item.date)} · ${safeText(item.feeling)}${nutrition ? " · " + safeText(nutrition) : ""}${item.micros ? " · " + safeText(item.micros) : ""}</div></div>
      <span class="activity-tag">FOOD</span>
    </div>`;
  }).join("");
}

function drawChart() {
  const canvas = $("progressChart");
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    days.push({ iso, label: d.toLocaleDateString(undefined, { weekday: "short" }) });
  }
  const counts = days.map(day => data.workouts.filter(w => w.date === day.iso).length);
  const max = Math.max(3, ...counts);
  const pad = { left: 34, right: 16, top: 18, bottom: 32 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  ctx.font = "12px DM Sans, sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 3; i++) {
    const y = pad.top + chartH - (chartH * i / 3);
    ctx.strokeStyle = "#343536";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    ctx.fillStyle = "#8f8e89";
    ctx.fillText(String(Math.round(max * i / 3)), pad.left - 9, y + 4);
  }

  const slot = chartW / 7;
  counts.forEach((count, i) => {
    const barW = Math.min(43, slot * .48);
    const barH = count === 0 ? 3 : (count / max) * chartH;
    const x = pad.left + slot * i + (slot - barW) / 2;
    const y = pad.top + chartH - barH;
    ctx.fillStyle = "#d9aa50";
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, barW, barH, 6);
    else ctx.rect(x, y, barW, barH);
    ctx.fill();
    ctx.fillStyle = "#aaa9a3";
    ctx.textAlign = "center";
    ctx.fillText(days[i].label, x + barW / 2, height - 10);
    if (count > 0) {
      ctx.fillStyle = "#f3d28f";
      ctx.fillText(String(count), x + barW / 2, Math.max(12, y - 7));
    }
  });
}

function render() {
  renderStats();
  renderAchievements();
  renderActivity();
  renderWater();
  renderCalories();
  renderRecords();
  renderCalendar();
  drawChart();
}

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    button.classList.add("active");
    currentTab = button.dataset.tab;
    renderActivity();
  });
});

$("clearBtn").addEventListener("click", () => {
  if (!confirm("Delete all workout and food journal entries from this browser? This cannot be undone.")) return;
  data = { workouts: [], food: [], water: [] };
  saveData();
  render();
  toast("Your journal has been cleared.");
});

$("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "gold-track-journal.json";
  link.click();
  URL.revokeObjectURL(url);
  toast("Journal backup downloaded.");
});

render();

if ($("exportBtnMobile")) {
  $("exportBtnMobile").addEventListener("click", () => {
    if ($("exportBtn")) $("exportBtn").click();
  });
}
