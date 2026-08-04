'use strict';

/**
 * Attach GET / so mount roots respond 200 with a short route map
 * (avoids bare 404s on POST-only or nested-only routers).
 *
 * @param {import('express').Router} router
 * @param {{ name: string, routes: Array<{ method: string, path: string, note?: string }> }} opts
 */
function attachRouteIndex(router, { name, routes }) {
  router.get('/', (req, res) => {
    res.status(200).json({
      success: true,
      service: name,
      message: `${name} API is available`,
      routes: routes || [],
    });
  });
}

module.exports = { attachRouteIndex };
