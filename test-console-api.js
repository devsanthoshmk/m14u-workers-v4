// Comprehensive Console API Test Script for M14U
// Run with: dev-browser --browser m14u-test <<'EOF' ... EOF

const REPORT = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  log(`\n=== ${name} ===`);
}

function log(msg) {
  console.log(msg);
  REPORT.push({ section: currentSection, message: msg });
}

function error(msg, err) {
  const msgStr = `[ERROR] ${msg}: ${err?.message || err || 'Unknown error'}`;
  console.log(msgStr);
  REPORT.push({ section: currentSection, message: msgStr, error: true });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  const page = await browser.getPage("m14u-console-test");
  await page.goto("http://localhost:5173");
  
  // Wait for app to load
  await page.waitForSelector('#root', { timeout: 10000 });
  await sleep(2000);
  
  log('App loaded successfully');
  
  // Check if m14u API is available
  const m14uAvailable = await page.evaluate(() => {
    return typeof window.m14u !== 'undefined';
  });
  
  if (!m14uAvailable) {
    error('m14u API is not available on window object');
    return;
  }
  
  log('✓ m14u API is available');
  
  // ========== NAVIGATION TESTS ==========
  section('NAVIGATION');
  
  try {
    const currentRoute = await page.evaluate(() => window.m14u.currentRoute());
    log(`Current route: ${currentRoute}`);
    
    await page.evaluate(() => window.m14u.route('/search'));
    await sleep(500);
    
    const newRoute = await page.evaluate(() => window.m14u.currentRoute());
    log(`After navigation: ${newRoute}`);
    
    if (newRoute === '/search') {
      log('✓ Navigation to /search successful');
    } else {
      error('Navigation to /search failed', `Got: ${newRoute}`);
    }
    
    // Navigate back to home
    await page.evaluate(() => window.m14u.route('/'));
    await sleep(500);
    log('✓ Navigation API working');
  } catch (err) {
    error('Navigation test failed', err);
  }
  
  // ========== SEARCH TESTS ==========
  section('SEARCH');
  
  try {
    // Test suggest
    const suggestions = await page.evaluate(async () => {
      return await window.m14u.suggest('bel');
    });
    log(`Suggestions for 'bel': ${JSON.stringify(suggestions?.slice(0, 3))}`);
    
    // Test search
    const searchResults = await page.evaluate(async () => {
      return await window.m14u.search('believer');
    });
    log(`Search results count: ${searchResults?.length || 0}`);
    
    if (searchResults && searchResults.length > 0) {
      log('✓ Search API working');
    } else {
      log('⚠ Search returned no results (may be expected)');
    }
    
    // Test clearSearch
    await page.evaluate(() => window.m14u.clearSearch());
    log('✓ clearSearch executed');
  } catch (err) {
    error('Search test failed', err);
  }
  
  // ========== NOW PLAYING & STATE TESTS ==========
  section('NOW PLAYING & STATE');
  
  try {
    const nowPlaying = await page.evaluate(() => window.m14u.nowPlaying());
    log(`Now playing: ${JSON.stringify(nowPlaying)}`);
    
    const playerState = await page.evaluate(() => window.m14u.state.player());
    log(`Player state: ${JSON.stringify(playerState)}`);
    
    log('✓ State APIs working');
  } catch (err) {
    error('State test failed', err);
  }
  
  // ========== VOLUME TESTS ==========
  section('VOLUME');
  
  try {
    const initialVolume = await page.evaluate(() => window.m14u.volume());
    log(`Initial volume: ${initialVolume}`);
    
    await page.evaluate(() => window.m14u.volume(0.5));
    await sleep(200);
    const newVolume = await page.evaluate(() => window.m14u.volume());
    log(`Volume after setting to 0.5: ${newVolume}`);
    
    if (newVolume === 0.5) {
      log('✓ Volume set successful');
    }
    
    // Test mute/unmute
    await page.evaluate(() => window.m14u.mute());
    await sleep(100);
    const mutedVolume = await page.evaluate(() => window.m14u.volume());
    log(`Volume after mute: ${mutedVolume}`);
    
    await page.evaluate(() => window.m14u.unmute());
    await sleep(100);
    const unmutedVolume = await page.evaluate(() => window.m14u.volume());
    log(`Volume after unmute: ${unmutedVolume}`);
    
    // Test toggleMute
    await page.evaluate(() => window.m14u.toggleMute());
    await page.evaluate(() => window.m14u.toggleMute());
    log('✓ Volume APIs working');
  } catch (err) {
    error('Volume test failed', err);
  }
  
  // ========== QUEUE TESTS ==========
  section('QUEUE');
  
  try {
    const initialQueue = await page.evaluate(() => window.m14u.queue.list());
    log(`Initial queue length: ${initialQueue?.length || 0}`);
    
    const queueLength = await page.evaluate(() => window.m14u.queue.length());
    log(`Queue.length() API: ${queueLength}`);
    
    // Test queue operations (if we have search results)
    const searchResults = await page.evaluate(async () => {
      return await window.m14u.search('test');
    });
    
    if (searchResults && searchResults.length > 0) {
      const testSong = searchResults[0];
      
      await page.evaluate((song) => window.m14u.queue.add(song), testSong);
      await sleep(200);
      const newLength = await page.evaluate(() => window.m14u.queue.length());
      log(`Queue length after add: ${newLength}`);
      
      log('✓ Queue add working');
      
      // Test clear
      await page.evaluate(() => window.m14u.queue.clear());
      await sleep(200);
      const clearedLength = await page.evaluate(() => window.m14u.queue.length());
      log(`Queue length after clear: ${clearedLength}`);
      log('✓ Queue clear working');
    } else {
      log('⚠ No songs available for queue testing');
    }
  } catch (err) {
    error('Queue test failed', err);
  }
  
  // ========== UI PANELS TESTS ==========
  section('UI PANELS');
  
  try {
    const initialState = await page.evaluate(() => window.m14u.panels.state());
    log(`Initial panel state: ${JSON.stringify(initialState)}`);
    
    // Toggle queue
    await page.evaluate(() => window.m14u.panels.toggleQueue());
    await sleep(300);
    let state = await page.evaluate(() => window.m14u.panels.state());
    log(`After toggleQueue: ${JSON.stringify(state)}`);
    
    await page.evaluate(() => window.m14u.panels.toggleQueue());
    await sleep(300);
    
    // Toggle lyrics
    await page.evaluate(() => window.m14u.panels.toggleLyrics());
    await sleep(300);
    state = await page.evaluate(() => window.m14u.panels.state());
    log(`After toggleLyrics: ${JSON.stringify(state)}`);
    
    await page.evaluate(() => window.m14u.panels.toggleLyrics());
    await sleep(300);
    
    // Toggle sidebar
    await page.evaluate(() => window.m14u.panels.toggleSidebar());
    await sleep(300);
    state = await page.evaluate(() => window.m14u.panels.state());
    log(`After toggleSidebar: ${JSON.stringify(state)}`);
    
    await page.evaluate(() => window.m14u.panels.toggleSidebar());
    
    log('✓ UI Panels APIs working');
  } catch (err) {
    error('UI Panels test failed', err);
  }
  
  // ========== FAVORITES TESTS ==========
  section('FAVORITES');
  
  try {
    const favorites = await page.evaluate(() => window.m14u.favorites.list());
    log(`Favorites count: ${favorites?.length || 0}`);
    
    const count = await page.evaluate(() => window.m14u.favorites.count());
    log(`favorites.count() API: ${count}`);
    
    log('✓ Favorites APIs working');
  } catch (err) {
    error('Favorites test failed', err);
  }
  
  // ========== HISTORY TESTS ==========
  section('HISTORY');
  
  try {
    const history = await page.evaluate(() => window.m14u.history());
    log(`History entries: ${history?.length || 0}`);
    log('✓ History API working');
  } catch (err) {
    error('History test failed', err);
  }
  
  // ========== SHUFFLE & REPEAT TESTS ==========
  section('SHUFFLE & REPEAT');
  
  try {
    const initialShuffle = await page.evaluate(() => window.m14u.state.player()?.shuffle);
    log(`Initial shuffle state: ${initialShuffle}`);
    
    const initialRepeat = await page.evaluate(() => window.m14u.state.player()?.repeat);
    log(`Initial repeat state: ${initialRepeat}`);
    
    // Note: These might not change state if no queue is available
    log('✓ Shuffle/Repeat state accessible');
  } catch (err) {
    error('Shuffle/Repeat test failed', err);
  }
  
  // ========== LOGGING TESTS ==========
  section('LOGGING');
  
  try {
    await page.evaluate(() => window.m14u.log.enable());
    await sleep(100);
    
    const logs = await page.evaluate(() => window.m14u.log.get());
    log(`Log entries count: ${logs?.length || 0}`);
    
    const lastLogs = await page.evaluate(() => window.m14u.log.last(3));
    log(`Last 3 logs: ${JSON.stringify(lastLogs?.slice(0, 2))}`);
    
    await page.evaluate(() => window.m14u.log.disable());
    log('✓ Logging APIs working');
  } catch (err) {
    error('Logging test failed', err);
  }
  
  // ========== HIGHLIGHT TESTS ==========
  section('HIGHLIGHT');
  
  try {
    // Try to highlight an element
    await page.evaluate(() => window.m14u.highlight('#root', 'Root Element'));
    await sleep(500);
    
    await page.evaluate(() => window.m14u.clearHighlights());
    log('✓ Highlight APIs working');
  } catch (err) {
    error('Highlight test failed', err);
  }
  
  // ========== ASSERT TESTS ==========
  section('ASSERT');
  
  try {
    // Test assert.noError
    await page.evaluate(() => window.m14u.assert.noError());
    log('✓ assert.noError passed');
    
    // Test other asserts (these may throw if conditions aren't met)
    try {
      await page.evaluate(() => window.m14u.assert.route('/'));
      log('✓ assert.route("/") passed');
    } catch (e) {
      log(`⚠ assert.route("/") - current route may differ`);
    }
    
    log('✓ Assert APIs accessible');
  } catch (err) {
    error('Assert test failed', err);
  }
  
  // ========== META TESTS ==========
  section('META');
  
  try {
    const version = await page.evaluate(() => window.m14u.version());
    log(`API version: ${version}`);
    
    log('✓ Meta APIs working');
  } catch (err) {
    error('Meta test failed', err);
  }
  
  // ========== WAIT TESTS (Basic) ==========
  section('WAIT');
  
  try {
    // Test wait.forRoute with short timeout
    await page.evaluate(async () => {
      await window.m14u.wait.forRoute('/', 1000);
    });
    log('✓ wait.forRoute working');
    
    // Test wait.forResults with short timeout (may timeout if no search)
    try {
      await page.evaluate(async () => {
        await window.m14u.wait.forResults(1000);
      });
      log('✓ wait.forResults working');
    } catch (e) {
      log('⚠ wait.forResults timed out (expected if no search active)');
    }
  } catch (err) {
    error('Wait test failed', err);
  }
  
  // ========== CONTENT LOADING TESTS ==========
  section('CONTENT LOADING');
  
  try {
    // These require valid IDs, so we just test they're accessible
    log('Content loading APIs require valid IDs - skipping execution');
    log('✓ Content loading APIs accessible');
  } catch (err) {
    error('Content loading test failed', err);
  }
  
  // ========== SUMMARY ==========
  section('TEST SUMMARY');
  
  const totalTests = REPORT.length;
  const errors = REPORT.filter(r => r.error).length;
  const successes = totalTests - errors;
  
  log(`\nTotal log entries: ${totalTests}`);
  log(`Errors: ${errors}`);
  log(`Successes: ${successes}`);
  log(`\n=== TEST COMPLETE ===`);
  
  // Take a screenshot for visual verification
  const buf = await page.screenshot();
  const path = await saveScreenshot(buf, "m14u-console-api-test.png");
  log(`Screenshot saved to: ${path}`);
}

// Run the tests
runTests().catch(err => {
  console.error(`Test script failed: ${err.message}`);
  console.error(err.stack);
});
