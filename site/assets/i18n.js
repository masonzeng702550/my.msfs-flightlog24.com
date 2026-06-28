// Lightweight i18n + a consistent inline-SVG icon set, shared by all pages.
// Language is persisted in localStorage; switching reloads so every string
// (static via data-i18n, dynamic via I18N.t) comes out in the chosen language.
(function () {
  const T = {
    en: {
      tagline: "Microsoft Flight Simulator · personal flight logbook",
      globe_hint: "Drag to rotate · scroll to zoom · click a route · zoom in for satellite",
      back_to_globe: "Back to globe", back_to_all: "All flights",
      splash_home: "Loading flights", splash_flight: "Loading flight",
      footer_pre: "Recorded with", footer_post: "· rebuilt automatically on every push",
      flights: "flights", complete: "complete", partial: "partial",
      around_earth: "around Earth", airports: "airports",
      analytics_title: "Flight analysis",
      top_airports: "Top airports", top_airlines: "Top airlines", top_aircraft: "Top aircraft",
      top_routes: "Top routes", top_countries: "Top countries",
      u_airports: "airports", u_airlines: "airlines", u_aircraft: "aircraft", u_routes: "routes", u_countries: "countries",
      per_year: "Flights per year", per_month: "Flights per month", per_weekday: "Flights per weekday",
      list_heading: "Flights", search_ph: "Search aircraft / airport…", all_aircraft: "All aircraft",
      sort_date: "Newest first", sort_dist: "Longest distance", empty: "No matching flights",
      cell_cruise: "cruise ft", cell_block: "block",
      loading: "Loading…", missing_id: "Missing flight ID", not_found: "Flight not found",
      k_track: "track distance", k_cruise: "cruise altitude", k_block: "block time", k_air: "air time",
      profile_title: "Altitude & speed profile", flight_data: "Flight data",
      l_departure: "Departure", l_arrival: "Arrival", l_aircraft: "Aircraft", l_airline: "Airline",
      l_maxalt: "Max altitude", l_maxgs: "Max ground speed", l_direct: "Direct distance",
      l_landing: "Landing", l_frames: "Frames recorded", l_recording: "Recording",
      rate_greaser: "greaser", rate_normal: "normal", rate_firm: "firm", rate_hard: "hard",
    },
    zh: {
      tagline: "Microsoft Flight Simulator · 個人飛行日誌",
      globe_hint: "拖曳旋轉 · 滾輪縮放 · 點擊航線 · 放大切換衛星圖",
      back_to_globe: "回到地球", back_to_all: "全部飛行",
      splash_home: "載入飛行紀錄", splash_flight: "載入航班",
      footer_pre: "使用", footer_post: "錄製 · 每次 push 自動重建",
      flights: "趟", complete: "完整", partial: "不完整",
      around_earth: "繞地球", airports: "機場",
      analytics_title: "飛行分析",
      top_airports: "熱門機場", top_airlines: "熱門航空", top_aircraft: "熱門機種",
      top_routes: "熱門航線", top_countries: "熱門國家",
      u_airports: "機場", u_airlines: "航空", u_aircraft: "機種", u_routes: "航線", u_countries: "國家",
      per_year: "每年航班", per_month: "每月航班", per_weekday: "每週航班",
      list_heading: "飛行紀錄", search_ph: "搜尋機型 / 機場…", all_aircraft: "所有機型",
      sort_date: "最新優先", sort_dist: "距離最長", empty: "沒有符合的飛行紀錄",
      cell_cruise: "巡航 ft", cell_block: "區塊時間",
      loading: "載入中…", missing_id: "缺少飛行 ID", not_found: "找不到這趟飛行",
      k_track: "航跡距離", k_cruise: "巡航高度", k_block: "區塊時間", k_air: "空中時間",
      profile_title: "高度與速度剖面", flight_data: "飛行資料",
      l_departure: "出發", l_arrival: "抵達", l_aircraft: "機型", l_airline: "航空公司",
      l_maxalt: "最高高度", l_maxgs: "最大地速", l_direct: "直線距離",
      l_landing: "落地", l_frames: "紀錄幀數", l_recording: "錄影檔",
      rate_greaser: "完美", rate_normal: "正常", rate_firm: "偏重", rate_hard: "重落地",
    },
    ja: {
      tagline: "Microsoft Flight Simulator · 個人フライトログ",
      globe_hint: "ドラッグで回転 · スクロールでズーム · 航路をクリック · 拡大で衛星表示",
      back_to_globe: "地球に戻る", back_to_all: "すべてのフライト",
      splash_home: "フライトを読み込み中", splash_flight: "フライトを読み込み中",
      footer_pre: "記録ツール:", footer_post: "· push ごとに自動再構築",
      flights: "フライト", complete: "完了", partial: "不完全",
      around_earth: "地球周回", airports: "空港",
      analytics_title: "フライト分析",
      top_airports: "よく使う空港", top_airlines: "よく使う航空会社", top_aircraft: "よく使う機種",
      top_routes: "よく飛ぶ路線", top_countries: "よく行く国",
      u_airports: "空港", u_airlines: "航空会社", u_aircraft: "機種", u_routes: "路線", u_countries: "国",
      per_year: "年別フライト", per_month: "月別フライト", per_weekday: "曜日別フライト",
      list_heading: "フライト", search_ph: "機種・空港で検索…", all_aircraft: "すべての機種",
      sort_date: "新しい順", sort_dist: "距離が長い順", empty: "該当するフライトがありません",
      cell_cruise: "巡航 ft", cell_block: "ブロック",
      loading: "読み込み中…", missing_id: "フライトIDがありません", not_found: "フライトが見つかりません",
      k_track: "飛行距離", k_cruise: "巡航高度", k_block: "ブロックタイム", k_air: "飛行時間",
      profile_title: "高度・速度プロファイル", flight_data: "フライトデータ",
      l_departure: "出発", l_arrival: "到着", l_aircraft: "機種", l_airline: "航空会社",
      l_maxalt: "最高高度", l_maxgs: "最大対地速度", l_direct: "直線距離",
      l_landing: "着陸", l_frames: "記録フレーム数", l_recording: "録画ファイル",
      rate_greaser: "完璧", rate_normal: "普通", rate_firm: "やや強め", rate_hard: "ハード",
    },
    ko: {
      tagline: "Microsoft Flight Simulator · 개인 비행 일지",
      globe_hint: "드래그 회전 · 스크롤 확대 · 항로 클릭 · 확대 시 위성",
      back_to_globe: "지구로 돌아가기", back_to_all: "전체 비행",
      splash_home: "비행 기록 불러오는 중", splash_flight: "비행 불러오는 중",
      footer_pre: "기록 도구:", footer_post: "· push 시 자동 재빌드",
      flights: "편", complete: "완료", partial: "부분",
      around_earth: "지구 바퀴", airports: "공항",
      analytics_title: "비행 분석",
      top_airports: "주요 공항", top_airlines: "주요 항공사", top_aircraft: "주요 기종",
      top_routes: "주요 노선", top_countries: "주요 국가",
      u_airports: "공항", u_airlines: "항공사", u_aircraft: "기종", u_routes: "노선", u_countries: "국가",
      per_year: "연도별 비행", per_month: "월별 비행", per_weekday: "요일별 비행",
      list_heading: "비행 기록", search_ph: "기종 / 공항 검색…", all_aircraft: "모든 기종",
      sort_date: "최신순", sort_dist: "거리 긴 순", empty: "일치하는 비행이 없습니다",
      cell_cruise: "순항 ft", cell_block: "블록",
      loading: "불러오는 중…", missing_id: "비행 ID 없음", not_found: "비행을 찾을 수 없습니다",
      k_track: "비행 거리", k_cruise: "순항 고도", k_block: "블록 시간", k_air: "공중 시간",
      profile_title: "고도 및 속도 프로파일", flight_data: "비행 데이터",
      l_departure: "출발", l_arrival: "도착", l_aircraft: "기종", l_airline: "항공사",
      l_maxalt: "최고 고도", l_maxgs: "최대 대지속도", l_direct: "직선 거리",
      l_landing: "착륙", l_frames: "기록 프레임", l_recording: "녹화 파일",
      rate_greaser: "완벽", rate_normal: "보통", rate_firm: "약간 강함", rate_hard: "하드",
    },
  };

  const SUPPORTED = ["zh", "en", "ja", "ko"];
  const LABELS = { zh: "中文", en: "English", ja: "日本語", ko: "한국어" };

  function detect() {
    const saved = localStorage.getItem("lang");
    if (saved && SUPPORTED.includes(saved)) return saved;
    const n = (navigator.language || "en").toLowerCase();
    if (n.startsWith("zh")) return "zh";
    if (n.startsWith("ja")) return "ja";
    if (n.startsWith("ko")) return "ko";
    if (n.startsWith("en")) return "en";
    return "zh";
  }
  const lang = detect();
  const t = key => (T[lang] && T[lang][key]) || T.en[key] || key;

  // consistent line-style icon set (currentColor, sized via .icon in CSS)
  const I = (b) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${b}</svg>`;
  const ICONS = {
    chart: I(`<path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="5"/><rect x="12" y="8" width="3" height="9"/><rect x="17" y="14" width="3" height="3"/>`),
    chevron: I(`<path d="M6 9l6 6 6-6"/>`),
    back: I(`<path d="M15 18l-6-6 6-6"/>`),
    download: I(`<path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/>`),
    note: I(`<path d="M5 4h14v11l-4 5H5z"/><path d="M15 20v-5h4"/>`),
    play: `<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`,
    pause: `<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`,
  };

  function applyStatic() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-ph]").forEach(el => { el.placeholder = t(el.getAttribute("data-i18n-ph")); });
    document.querySelectorAll("[data-icon]").forEach(el => {
      if (!el.dataset.iconDone) { el.insertAdjacentHTML("afterbegin", ICONS[el.getAttribute("data-icon")] || ""); el.dataset.iconDone = "1"; }
    });
  }

  function buildSwitcher() {
    const header = document.querySelector(".site-header");
    if (!header || document.getElementById("lang-select")) return;
    const sel = document.createElement("select");
    sel.id = "lang-select"; sel.className = "lang-select"; sel.setAttribute("aria-label", "Language");
    SUPPORTED.forEach(v => {
      const o = document.createElement("option");
      o.value = v; o.textContent = LABELS[v]; if (v === lang) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => { localStorage.setItem("lang", sel.value); location.reload(); });
    header.appendChild(sel);
  }

  window.I18N = { t, lang, ICONS };
  applyStatic();
  buildSwitcher();
})();
