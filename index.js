  // ═══════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════
  const PI = Math.PI;

  let transmitters   = [];
  let userLatRad     = null;
  let userLngRad     = null;
  let selectedTx     = null;
  let smoothedAlpha  = null;
  let compassRunning = false;

  const SMOOTH = 0.12;

  // ═══════════════════════════════════════════
  // LOAD TRANSMITTER DATA
  // ═══════════════════════════════════════════
  fetch('transmitters.json')
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(data => { transmitters = data; })
    .catch(() => {
      document.getElementById('locLine1').textContent = 'ERROR: transmitters.json not found';
    });

  // ═══════════════════════════════════════════
  // MATHS
  // ═══════════════════════════════════════════
  function haversine(la1, ln1, la2, ln2) {
    const dla = la2-la1, dln = ln2-ln1;
    const a = Math.sin(dla/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dln/2)**2;
    return 6371 * 2 * Math.asin(Math.sqrt(a));
  }

  function calcBearing(la1, ln1, la2, ln2) {
    const dln = ln2-ln1;
    const x = Math.sin(dln)*Math.cos(la2);
    const y = Math.cos(la1)*Math.sin(la2) - Math.sin(la1)*Math.cos(la2)*Math.cos(dln);
    return (Math.atan2(x,y)*180/PI + 360) % 360;
  }

  function recvPower(erp, distKm) {
    return 1000 * erp / (4 * PI * distKm * distKm);
  }

  function compassPt(deg) {
    const p = ['N','NNE','NE','ENE','E','ESE','SE','SSE',
                'S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return p[Math.round(deg/22.5) % 16];
  }

  function fmtDist(km) {
    return km < 10 ? km.toFixed(1)+' km' : Math.round(km)+' km';
  }

  function smoothAngle(cur, inc) {
    if (cur === null) return inc;
    let d = inc - cur;
    if (d >  180) d -= 360;
    if (d < -180) d += 360;
    return (cur + d*SMOOTH + 360) % 360;
  }

  // ═══════════════════════════════════════════
  // GPS — auto-start on load
  // ═══════════════════════════════════════════
  function onGPSSuccess(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    userLatRad = lat * PI / 180;
    userLngRad = lng * PI / 180;

    // Show coords on line 2 immediately
    document.getElementById('locLatLng').textContent =
      '\u00a0\u00a0\u00a0\u00a0\u00a0' +
      lat.toFixed(4) + '\u00b0\u00a0\u00a0' + lng.toFixed(4) + '\u00b0';

    // Step 2 & 3 — build table and select first entry immediately
    document.getElementById('scanBtn').disabled = false;
    doScan();

    // Step 4 — populate address after table/compass are rendered
    //setTimeout(() => reverseGeocode(lat, lng), 0);
    reverseGeocode(lat, lng);
  }

  function onGPSError(err) {
    const msg = err.code === 1 ? 'Location permission denied' : 'Could not get location';
    document.getElementById('locLine1').textContent = msg;
  }

  async function reverseGeocode(lat, lng) {
    document.getElementById('locLine1').textContent = 'Getting address\u2026';
    try {
      const [nomRes, pcRes] = await Promise.all([
        fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
          { headers: { 'Accept-Language': 'en' } }
        ),
        fetch(`https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1`)
      ]);

      const nomData = await nomRes.json();
      const pcData  = await pcRes.json();
      const a       = nomData.address || {};

      // Line 1 — road, place
      const road  = a.road || a.pedestrian || a.path || '';
      const place = a.village || a.town || pcData.result.nuts || a.city || '';
      document.getElementById('locLine1').textContent =
        [road, place].filter(Boolean).join(",\u00A0\u00A0") || 'Unknown location';

      // Line 2 — postcode then coords (already shown, just prepend postcode)
      const postcode = (pcData.status === 200 && pcData.result && pcData.result[0])
        ? pcData.result[0].postcode
        : (a.postcode || '');
      document.getElementById('locPostcode').textContent = postcode;

    } catch(e) {
      document.getElementById('locLine1').textContent = 'Address unavailable';
    }
  }

  // Request GPS on page load
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(onGPSSuccess, onGPSError, {
      enableHighAccuracy: true, timeout: 15000, maximumAge: 60000
    });
  } else {
    document.getElementById('locLine1').textContent = 'Geolocation not supported';
  }

  // ═══════════════════════════════════════════
  // SCAN
  // ═══════════════════════════════════════════
  function doScan() {
    if (!transmitters.length || userLatRad === null) return;

    const all = transmitters.map(tx => {
      const dist = haversine(userLatRad, userLngRad, tx.lat, tx.lng);
      const recv = recvPower(tx.power, dist);
      const brg  = calcBearing(userLatRad, userLngRad, tx.lat, tx.lng);
      return { ...tx, dist, recv, brg };
    });

    const top6 = all.sort((a,b) => b.recv - a.recv).slice(0, 6);
    const maxRecv = top6[0].recv;
    top6.forEach(tx => { tx.pct = Math.round(tx.recv / maxRecv * 100); });

    renderTxList(top6);
    
    document.getElementById('cmpNote2').textContent = 'Relative';
    document.getElementById('cmpNote3').textContent = 'Power&nbsp;';
  }

  function renderTxList(data) {
    const list = document.getElementById('txList');
    list.innerHTML = '';

    data.forEach((tx, i) => {
      const div = document.createElement('div');
      div.className = 'tx-row';
      div.onclick = () => selectTx(tx, div);
      div.innerHTML = `
        <span class="tx-rank">#${i+1}</span>
        <div class="tx-info">
          <div class="tx-name">${tx.site}</div>
          <div class="tx-meta-row">
            <span>${tx.region}</span>
            <span>${tx.pol}</span>
            <span>${fmtDist(tx.dist)}</span>
            <span>${Math.round(tx.brg)}\u00b0\u2009${compassPt(tx.brg)}</span>
          </div>
        </div>
        <span class="tx-sig">${tx.pct}%</span>`;
      list.appendChild(div);
    });

    // Auto-select first entry
    const firstRow = list.querySelector('.tx-row');
    if (firstRow) firstRow.click();
  }

  // ═══════════════════════════════════════════
  // SELECT TRANSMITTER
  // ═══════════════════════════════════════════
  function selectTx(tx, rowEl) {
    document.querySelectorAll('.tx-row').forEach(r => r.classList.remove('selected'));
    rowEl.classList.add('selected');
    selectedTx = tx;

    document.getElementById('cmpTitle').textContent = tx.site;
    document.getElementById('cmpTitle').classList.add('active');
    document.getElementById('cmpStats').style.display = 'flex';
    document.getElementById('cmpBrg').textContent  = Math.round(tx.brg) + '\u00b0';
    document.getElementById('cmpDir').textContent  = compassPt(tx.brg);
    document.getElementById('cmpDist').textContent = fmtDist(tx.dist);

    // Show polarisation
    const polEl = document.getElementById('polLabel');
    polEl.textContent = tx.pol || '?';
    polEl.style.opacity = '1';

    // Show pointer
    document.getElementById('pointerGroup').style.opacity = '1';

    // Static bearing until sensor fires
    setPointer(tx.brg, smoothedAlpha !== null ? smoothedAlpha : 0);

    startCompass();
  }

  // ═══════════════════════════════════════════
  // COMPASS
  // ═══════════════════════════════════════════
  // Confirmed sensor convention (user-tested):
  //   alpha DECREASES as phone rotates CLOCKWISE
  //   roseGroup: rotate(+alpha) keeps N on magnetic north
  //   pointerGroup: rotate((brg + alpha) % 360) locks onto transmitter

  function setPointer(brg, alpha) {
    document.getElementById('roseGroup').style.transform =
      `rotate(${alpha % 360}deg)`;
    document.getElementById('pointerGroup').style.transform =
      `rotate(${(brg + alpha) % 360}deg)`;
  }

  function onOrientation(e) {
    if (e.alpha === null || e.alpha === undefined) return;
    smoothedAlpha = smoothAngle(smoothedAlpha, e.alpha);

    if (selectedTx) {
      setPointer(selectedTx.brg, smoothedAlpha);
    } else {
      document.getElementById('roseGroup').style.transform =
        `rotate(${smoothedAlpha}deg)`;
    }

    document.getElementById('cmpNote').textContent = 'Hold phone flat, face up';

    // Colour pointer green if phone is aimed within ±5° of transmitter
    if (selectedTx) {
      let diff = Math.abs(selectedTx.brg + smoothedAlpha) % 360;
      const colour = diff <= 5 ? '#52cdb4' : '#f95c5c';
      document.getElementById('pointerArrow').setAttribute('fill', colour);
      document.getElementById('polLabel').setAttribute('fill', colour);
    }
  }

  function startCompass() {
    if (compassRunning) return;
    compassRunning = true;
    smoothedAlpha  = null;

    // Remove first to prevent duplicate listeners risk
    window.removeEventListener('deviceorientationabsolute', onOrientation, true);

    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', onOrientation, true);
    } else {
      document.getElementById('cmpNote').textContent =
        'Orientation sensor not supported';
    }
  }

  // ═══════════════════════════════════════════
  // SERVICE WORKER
  // ═══════════════════════════════════════════
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
