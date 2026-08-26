(function () {
    'use strict';

    // This filename existed in the retired browser-only mock. Some smart TVs
    // keep that HTML for a long time, so turn the old script request into a
    // one-time migration to the live dashboard instead of reviving mock data.
    try {
        Object.keys(window.localStorage).forEach(function (key) {
            if (key.indexOf('wbs_stage1_mock_v1_') === 0) {
                window.localStorage.removeItem(key);
            }
        });
    } catch (error) {
        // Storage can be disabled in TV browsers; navigation still works.
    }

    try {
        if (!window.sessionStorage.getItem('kpetro_live_dashboard_migrated')) {
            window.sessionStorage.setItem('kpetro_live_dashboard_migrated', '1');
            window.location.replace('/tv?from=legacy-mock');
        }
    } catch (error) {
        window.location.replace('/tv?from=legacy-mock');
    }
})();
