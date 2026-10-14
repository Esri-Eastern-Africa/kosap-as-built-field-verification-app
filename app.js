/* =========================================================================
 * Minigrid Asset Verification
 * ArcGIS Maps SDK for JavaScript 4.33 + Calcite Components 3.x
 *
 * Flow:
 *   1. OAuth 2.0 sign-in against the Esri Eastern Africa enterprise portal.
 *   2. Load the three feature layers of the "Minigrid Assets" feature service,
 *      filtered to UNVERIFIED features (is_verified = 'False' OR is_verified IS NULL).
 *   3. Each feature's popup carries a "Verify Asset" button that stamps
 *      is_verified = 'True', verified_by = <signed-in user>, verification_date = now.
 *      Once verified, the feature drops out of the filter and leaves the map.
 * ========================================================================= */

/* -------------------------------------------------------------------------
 * CONFIG  — the only values you should ever need to change.
 *
 * ❗ appId: paste the OAuth *App ID / Client ID* of the registered application
 *   item in your portal. See the README for how to get it. The application
 *   item "Minigrid Asset Verification App" has already been created in your
 *   portal (item id 95b1af9c29fe41d09a122428f3425ee0); open it in the portal
 *   UI → Settings → "App Registration" → Register, add your redirect URI, then
 *   copy the generated App ID here.
 * ----------------------------------------------------------------------- */
const CONFIG = {
	portalUrl: "https://development.esriea.com/portal",
	appId: "MQDuC6dbXv6eIDx4",
	featureServiceUrl:
		"https://development.esriea.com/server/rest/services/Hosted/Minigrid_assets/FeatureServer",

	// Field names (confirmed against the live service schema)
	fields: {
		isVerified: "is_verified",
		verifiedBy: "verified_by",
		verificationDate: "verification_date"
	},
	unverifiedValue: "False",
	verifiedValue: "True",

	// The three editable asset layers of the feature service.
	// `icon` is a picture-marker image (points); `line` styles polyline layers.
	// `yAdjust` nudges a base-anchored icon vertically (negative = down).
	layers: [
		{ id: 2, title: "Lines", line: { color: "#d83020", width: 2.5 } },
		{
			id: 0,
			title: "Poles",
			icon: "assets/pole.png",
			iconW: 16,
			iconH: 34,
			yAdjust: -20
		},
		{
			id: 1,
			title: "Transformers",
			icon: "assets/transformer.png",
			iconW: 24,
			iconH: 43,
			yAdjust: -20
		}
	],

	// Read-only reference/context layers (no verification workflow).
	referenceLayers: [
		{
			url: "https://development.esriea.com/server/rest/services/Hosted/Minigrids/FeatureServer/0",
			title: "Minigrids",
			popupTitle: "Minigrid : {project_name}",
			icon: "assets/minigrid.png",
			iconW: 34,
			iconH: 34,
			anchor: "center"
		}
	]
};

// Fields hidden from the popup field list (internal / editor tracking).
const HIDDEN_FIELDS = new Set([
	"objectid",
	"globalid",
	"shape__length",
	"shape__area",
	"created_user",
	"created_date",
	"last_edited_user",
	"last_edited_date"
]);

/* ------------------------------------------------------------------ state */
let currentUser = null;
const layerRegistry = []; // { cfg, layer }

/* ---------------------------------------------------------------- helpers */
const $ = (id) => document.getElementById(id);

function toast(title, message, kind = "success") {
	const el = $("toast");
	$("toastTitle").textContent = title;
	$("toastMsg").textContent = message || "";
	el.kind = kind; // success | danger | warning | info
	el.open = true;
}

function unverifiedWhere() {
	const f = CONFIG.fields.isVerified;
	return `${f} = '${CONFIG.unverifiedValue}' OR ${f} IS NULL`;
}

/* ======================================================================= */
require([
	"esri/config",
	"esri/identity/OAuthInfo",
	"esri/identity/IdentityManager",
	"esri/portal/Portal",
	"esri/Map",
	"esri/views/MapView",
	"esri/layers/FeatureLayer",
	"esri/renderers/SimpleRenderer",
	"esri/symbols/PictureMarkerSymbol",
	"esri/symbols/SimpleLineSymbol",
	"esri/widgets/LayerList",
	"esri/widgets/Legend",
	"esri/widgets/BasemapGallery",
	"esri/widgets/Expand",
	"esri/widgets/Home"
], function (
	esriConfig,
	OAuthInfo,
	esriId,
	Portal,
	Map,
	MapView,
	FeatureLayer,
	SimpleRenderer,
	PictureMarkerSymbol,
	SimpleLineSymbol,
	LayerList,
	Legend,
	BasemapGallery,
	Expand,
	Home
) {
	esriConfig.portalUrl = CONFIG.portalUrl;

	const info = new OAuthInfo({
		appId: CONFIG.appId,
		portalUrl: CONFIG.portalUrl,
		popup: false, // redirect flow (whole-page) — simplest for enterprise
		flowType: "auto"
	});
	esriId.registerOAuthInfos([info]);

	const sharingUrl = CONFIG.portalUrl + "/sharing";

	/* ----------------------------------------------------- sign-in plumbing */
	function showSignIn(errMsg) {
		$("bootScrim").hidden = true;
		$("signInOverlay").hidden = false;
		const notice = $("signInError");
		if (errMsg) {
			notice.querySelector("[slot=message]").textContent = errMsg;
			notice.hidden = false;
			notice.open = true;
		} else {
			notice.hidden = true;
		}
	}

	$("signInBtn").addEventListener("click", async () => {
		if (CONFIG.appId === "REPLACE_WITH_YOUR_APP_ID") {
			showSignIn(
				"App is not configured: set CONFIG.appId in app.js to your portal OAuth App ID."
			);
			return;
		}
		try {
			await esriId.getCredential(sharingUrl, { oAuthPopupConfirmation: false });
			await startApp();
		} catch (err) {
			showSignIn("Sign-in failed or was cancelled. " + (err?.message || ""));
		}
	});

	$("signOutBtn").addEventListener("click", () => {
		esriId.destroyCredentials();
		window.location.reload();
	});

	/* --------------------------------------------------------- boot / resume */
	(async function boot() {
		try {
			await esriId.checkSignInStatus(sharingUrl);
			await startApp();
		} catch {
			showSignIn(); // not signed in yet
		}
	})();

	/* ========================================================= main app init */
	async function startApp() {
		$("signInOverlay").hidden = true;
		$("bootScrim").hidden = false;
		// Reveal the shell now (keep the scrim on top) so #viewDiv has real
		// dimensions — a MapView in a display:none container never becomes ready.
		$("appShell").hidden = false;

		// Identify the signed-in user (used to stamp verified_by).
		const portal = new Portal({ url: CONFIG.portalUrl });
		await portal.load();
		currentUser = portal.user ? portal.user.username : "unknown";

		const navUser = $("navUser");
		navUser.fullName = portal.user?.fullName || currentUser;
		navUser.username = currentUser;
		if (portal.user?.thumbnailUrl) navUser.thumbnail = portal.user.thumbnailUrl;
		navUser.hidden = false;
		$("signOutBtn").hidden = false;

		// Build the feature layers. Load each first so its schema (fields) is
		// available when we construct the popup template field list.
		const featureLayers = [];
		for (const cfg of CONFIG.layers) {
			const layer = new FeatureLayer({
				url: `${CONFIG.featureServiceUrl}/${cfg.id}`,
				title: cfg.title,
				outFields: ["*"],
				definitionExpression: unverifiedWhere()
			});
			await layer.load();
			const renderer = buildRenderer(cfg);
			if (renderer) layer.renderer = renderer;
			layer.popupTemplate = buildPopupTemplate(cfg, layer);
			layerRegistry.push({ cfg, layer });
			featureLayers.push(layer);
		}

		// Build read-only reference layers (e.g. Minigrids) — shown for context,
		// with no unverified filter and no verify button.
		const referenceLayers = [];
		for (const cfg of CONFIG.referenceLayers || []) {
			const layer = new FeatureLayer({
				url: cfg.url,
				title: cfg.title,
				outFields: ["*"]
			});
			await layer.load();
			const renderer = buildRenderer(cfg);
			if (renderer) layer.renderer = renderer;
			layer.popupTemplate = buildReferencePopup(cfg, layer);
			referenceLayers.push(layer);
		}

		const map = new Map({
			basemap: "streets-navigation-vector",
			// Reference layers first so the editable asset markers draw on top.
			layers: [...referenceLayers, ...featureLayers]
		});

		const view = new MapView({
			container: "viewDiv",
			map,
			popup: {
				dockEnabled: false,
				collapseEnabled: false
			}
		});
		mapViewRef = view;

		// Widgets
		view.ui.add(new Home({ view }), "top-left");

		const basemaps = new Expand({
			view,
			content: new BasemapGallery({ view }),
			expanded: false,
			expandIcon: "basemap",
			expandTooltip: "Switch basemap"
		});
		const legend = new Expand({
			view,
			content: new Legend({ view }),
			expanded: false,
			expandTooltip: "Legend"
		});
		view.ui.add([basemaps, legend], "top-right");

		// Sidebar layer list (visibility toggles)
		const layerList = new LayerList({ view, container: "layerListContainer" });

		// Responsive: dock the panel on wide screens, float+collapse on mobile.
		setupResponsivePanel();

		await view.when();

		// Zoom to the combined extent of all unverified features.
		await zoomToData(view, featureLayers);

		// Populate the "pending verification" counts.
		await refreshCounts(view);

		$("refreshBtn").addEventListener("click", async () => {
			featureLayers.forEach((l) => l.refresh());
			await refreshCounts(view);
			toast("Refreshed", "Layers and counts reloaded.", "info");
		});

		$("bootScrim").hidden = true;
	}

	/* ------------------------------------------------------------- symbology */
	function buildRenderer(cfg) {
		if (cfg.icon) {
			const yAdjust = cfg.yAdjust || 0;
			// anchor "center": marker centered on the point (e.g. a square icon).
			// otherwise: push up by half the height so the image base sits on the point.
			const yoffset = (cfg.anchor === "center" ? 0 : cfg.iconH / 2) + yAdjust;
			return new SimpleRenderer({
				symbol: new PictureMarkerSymbol({
					url: cfg.icon,
					width: cfg.iconW + "px",
					height: cfg.iconH + "px",
					yoffset: yoffset + "px"
				})
			});
		}
		if (cfg.line) {
			return new SimpleRenderer({
				symbol: new SimpleLineSymbol({
					color: cfg.line.color,
					width: cfg.line.width,
					cap: "round",
					join: "round"
				})
			});
		}
		return null;
	}

	/* --------------------------------------------------- responsive panel */
	function setupResponsivePanel() {
		const panel = document.getElementById("primaryPanel");
		const toggle = $("menuToggle");
		if (!panel) return;

		if (toggle) {
			toggle.addEventListener("click", () => {
				panel.collapsed = !panel.collapsed;
			});
		}

		const mq = window.matchMedia("(max-width: 860px)");
		const apply = (e) => {
			if (e.matches) {
				panel.displayMode = "float";
				panel.collapsed = true;
			} else {
				panel.displayMode = "dock";
				panel.collapsed = false;
			}
		};
		apply(mq);
		mq.addEventListener("change", apply);
	}

	/* --------------------------------------------------- popup + verify UI */
	function buildPopupTemplate(cfg, layer) {
		const content = [
			{
				type: "fields",
				fieldInfos: buildFieldInfos(layer)
			}
		];

		// Show attachments (image previews) when the layer supports them.
		if (layer.capabilities?.data?.supportsAttachment) {
			content.push({
				type: "attachments",
				displayType: "preview"
			});
		}

		content.push({
			type: "custom",
			creator: (event) => buildVerifyBlock(cfg, layer, event.graphic)
		});

		return {
			title: cfg.title,
			outFields: ["*"],
			content
		};
	}

	// Popup for read-only reference layers: fields + attachments, no verify button.
	function buildReferencePopup(cfg, layer) {
		const content = [{ type: "fields", fieldInfos: buildFieldInfos(layer) }];
		if (layer.capabilities?.data?.supportsAttachment) {
			content.push({ type: "attachments", displayType: "preview" });
		}
		return { title: cfg.popupTitle || cfg.title, outFields: ["*"], content };
	}

	// Build field infos from the loaded layer schema. The popup renders
	// coded-domain labels and formats dates automatically for "fields" content.
	function buildFieldInfos(layer) {
		return layer.fields
			.filter((f) => !HIDDEN_FIELDS.has(f.name.toLowerCase()))
			.map((f) => ({
				fieldName: f.name,
				label: f.alias || f.name,
				format:
					f.type === "date" || f.type === "date-only"
						? { dateFormat: "short-date-short-time" }
						: undefined
			}));
	}

	function buildVerifyBlock(cfg, layer, graphic) {
		const wrap = document.createElement("div");
		wrap.className = "verify-block";

		const alreadyVerified =
			graphic.attributes?.[CONFIG.fields.isVerified] === CONFIG.verifiedValue;

		const btn = document.createElement("calcite-button");
		btn.width = "full";
		btn.iconStart = "check-circle";
		btn.appearance = "solid";
		btn.kind = "brand";
		btn.textContent = "Verify Asset";

		if (alreadyVerified) {
			btn.disabled = true;
			btn.textContent = "Already verified";
		}

		btn.addEventListener("click", () => verifyAsset(cfg, layer, graphic, btn));

		wrap.appendChild(btn);
		return wrap;
	}

	async function verifyAsset(cfg, layer, graphic, btn) {
		const oidField = layer.objectIdField;
		const oid = graphic.attributes[oidField];

		btn.loading = true;
		btn.disabled = true;

		const updateFeature = {
			attributes: {
				[oidField]: oid,
				[CONFIG.fields.isVerified]: CONFIG.verifiedValue,
				[CONFIG.fields.verifiedBy]: currentUser,
				[CONFIG.fields.verificationDate]: Date.now() // epoch ms for date field
			}
		};

		try {
			const result = await layer.applyEdits({
				updateFeatures: [updateFeature]
			});
			const r = result.updateFeatureResults?.[0];
			if (r?.error) throw r.error;

			toast(
				"Asset verified",
				`${cfg.title} #${oid} verified by ${currentUser}.`,
				"success"
			);

			// Feature no longer matches the definition expression → refresh drops it.
			layer.refresh();
			if (mapViewRef?.popup) mapViewRef.popup.close();
			await refreshCounts(mapViewRef);
		} catch (err) {
			btn.loading = false;
			btn.disabled = false;
			toast("Verification failed", err?.message || String(err), "danger");
		}
	}

	/* ---------------------------------------------------------- counts/extent */
	let mapViewRef = null;

	async function refreshCounts(view) {
		mapViewRef = view || mapViewRef;
		const list = $("countList");
		list.innerHTML = "";

		for (const { cfg, layer } of layerRegistry) {
			const item = document.createElement("calcite-list-item");
			item.label = cfg.title;
			try {
				const count = await layer.queryFeatureCount({
					where: layer.definitionExpression || "1=1"
				});
				item.description = `${count} pending`;
				const badge = document.createElement("calcite-chip");
				badge.slot = "content-end";
				badge.scale = "s";
				badge.kind = count > 0 ? "brand" : "neutral";
				badge.textContent = String(count);
				item.appendChild(badge);
			} catch {
				item.description = "count unavailable";
			}
			list.appendChild(item);
		}
	}

	async function zoomToData(view, layers) {
		try {
			const extents = await Promise.all(
				layers.map(async (l) => {
					const res = await l.queryExtent({
						where: l.definitionExpression || "1=1"
					});
					return res && res.count > 0 ? res.extent : null;
				})
			);
			let full = null;
			extents.filter(Boolean).forEach((ext) => {
				full = full ? full.union(ext) : ext.clone();
			});
			if (full) await view.goTo(full.expand(1.2));
		} catch {
			/* non-fatal: keep default extent */
		}
	}
});
