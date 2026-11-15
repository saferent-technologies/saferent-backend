# App configuration — backend + Android integration

Super Admin (or anyone granted `app_config.manage`) controls the Android app from
**Admin panel → Administration → App configuration**. Changes reach the app without a new release.

Firebase is used **only for sign-in**. Configuration lives in SafeRent's MySQL database and is served by
the SafeRent API. No Firestore, no Remote Config.

---

## 1. How it is stored

| What | Where |
| --- | --- |
| App configuration (12 sections) | `app_config_versions` — one row per saved version (append-only). The active config is the highest version. |
| Shape, defaults, validation | `server/src/appConfig/schema.ts` (zod). Missing fields fall back to defaults, so new settings need no migration. |
| Property types on/off | existing `property_types` table (Admin → Property types) — read into the config, not copied |
| Razorpay on/off, min/max amount | existing `payment_gateways` table (Admin → Payment gateways) |
| Referral reward amounts | existing `referral_campaigns` table (Admin → Referrals) |

- **Versioning / history:** every save writes a new row with `version`, `changed_paths`, `note`, `created_by_id`, `created_at`, `updated_at`.
- **Rollback:** copies an older version into a **new** version (`action = ROLLBACK`, `rolled_back_from_version`). History is never rewritten.
- **Optimistic locking:** saves and rollbacks send `baseVersion`; if someone saved meanwhile the API answers `409 VERSION_CONFLICT`.
- **Defaults:** until the first save the API serves version `0` = defaults (support email and app name are seeded from the existing platform settings).
- **Cache:** each API instance caches the active config for 15 seconds; a save clears it at once on that instance.

Migration: `server/prisma/migrations/20261111180000_app_config` → run `npm run db:migrate`.

---

## 2. Endpoints

All routes exist under `/api/v1/...` (envelope: `{ success, message, data, meta }`) and `/api/...` (raw body, legacy).

### Public — no login (App Check applies when enforced)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/app/config` | Full client-safe configuration. Sends `ETag: "app-config-<version>"`; send `If-None-Match` to get `304 Not Modified`. |
| GET | `/api/v1/app/config/version` | `{ configVersion, updatedAt }` — cheap poll. |
| GET | `/api/v1/app/config/check-update?version=1.2.0&platform=android` | What the installed app must do. |

### Admin — `app_config.manage` (Super Admin by default, can be granted to other staff roles in Roles & permissions)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/admin/app-config` | Full config, defaults, version, last editor, linked settings |
| PUT | `/api/v1/admin/app-config` | Body `{ baseVersion, config, note? }` → new version |
| GET | `/api/v1/admin/app-config/history?page=1&pageSize=20` | Versions, newest first |
| GET | `/api/v1/admin/app-config/history/{id}` | One version in full |
| POST | `/api/v1/admin/app-config/rollback/{id}` | Body `{ baseVersion, note? }` → restores as a new version |

Every save and rollback is also written to the admin activity log (`app_config.update`, `app_config.rollback`).

---

## 3. Sample responses

`GET /api/v1/app/config` (defaults, shortened lists):

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "configVersion": 1,
    "updatedAt": "2026-11-11T18:05:12.000Z",
    "app": { "name": "SafeRent", "packageName": "com.saferent.app", "latestVersion": "1.0.0", "minimumSupportedVersion": "1.0.0", "forceUpdate": false, "updateMessage": "A new version of SafeRent is available. Please update to continue.", "playStoreUrl": "" },
    "maintenance": { "enabled": false, "title": "", "message": "", "startsAt": null, "expectedEndAt": null },
    "features": { "properties": true, "tenants": true, "landlords": true, "rentManagement": true, "rentPayments": true, "rentReminders": true, "documents": true, "rentalAgreements": true, "electricityBills": true, "propertyTaxDocuments": true, "otherDocuments": true, "notifications": true, "referrals": true, "support": true, "chat": false },
    "auth": { "emailLogin": true, "phoneLogin": true, "emailOtp": true, "phoneOtp": true, "googleLogin": false, "otpExpiryMinutes": 5, "otpResendSeconds": 60, "otpMaxAttempts": 5, "showDemographics": true, "demographicsSkippable": true },
    "properties": { "enabledTypes": [{ "key": "APARTMENT", "label": "Apartment", "category": "RESIDENTIAL", "structure": "MULTI_UNIT" }, { "key": "PG", "label": "PG", "category": "RESIDENTIAL", "structure": "ROOMS_BEDS" }], "maxImages": 40, "maxDocuments": 50, "maxImageSizeMB": 5, "allowedImageFormats": ["jpg", "jpeg", "png", "webp"] },
    "documents": { "agreement": true, "electricityBill": true, "propertyTax": true, "otherDocuments": true, "customNameRequired": true, "maxFileSizeMB": 10, "allowedFormats": ["pdf", "jpg", "jpeg", "png"], "notifyTenantOnUpload": true, "defaultVisibility": "PRIVATE" },
    "notifications": { "pushEnabled": true, "rentDue": true, "rentOverdue": true, "paymentSuccess": true, "documentUploaded": true, "agreementUploaded": true, "propertyAssigned": true, "maintenance": true },
    "payments": { "enabled": true, "razorpay": true, "upi": true, "card": true, "netbanking": true, "currency": "INR", "convenienceFee": { "type": "NONE", "value": 0, "maxAmount": null }, "minAmount": 10, "maxAmount": 10000 },
    "referrals": { "enabled": true, "minSuccessfulReferrals": 1, "eligibilityRules": "Rewards are credited after…", "programs": [{ "type": "LANDLORD_TO_LANDLORD", "rewardAmount": 100, "durationMonths": null }] },
    "support": { "email": "support@saferenttechnologies.com", "phone": "", "whatsapp": "", "helpCenterUrl": "", "faqEnabled": false },
    "splash": { "version": "1.4", "enabled": true, "title": "SafeRent", "description": "Verified homes. Honest renting.", "lightLogoUrl": "", "darkLogoUrl": "", "lottieUrl": "https://cdn.example.com/loading.json", "minDurationMs": 1500 },
    "onboarding": {
      "version": "2.0", "enabled": true, "showOnce": true, "skippable": true, "skipButtonText": "Skip",
      "screens": [
        { "id": "screen-a1b2c3", "title": "Verified owners", "description": "Every owner is verified with DigiLocker.", "buttonText": "Next", "mediaType": "LOTTIE", "imageUrl": "", "videoUrl": "", "lottieUrl": "https://cdn.example.com/verified.json" },
        { "id": "screen-d4e5f6", "title": "Every charge upfront", "description": "Rent, deposit and maintenance before you apply.", "buttonText": "Next", "mediaType": "IMAGE", "imageUrl": "https://cdn.example.com/charges.webp", "videoUrl": "", "lottieUrl": "" },
        { "id": "screen-g7h8i9", "title": "Your rental in one place", "description": "Lease, rent and receipts online.", "buttonText": "Get started", "mediaType": "VIDEO", "imageUrl": "", "videoUrl": "https://cdn.example.com/rental.mp4", "lottieUrl": "" }
      ]
    },
    "ui": { "primaryColor": "#F97316", "secondaryColor": "#111827", "accentColor": "#FB923C", "logoUrl": "", "darkMode": true, "announcementEnabled": false, "announcementTitle": "", "announcementMessage": "", "bannerEnabled": false, "bannerImageUrl": "", "bannerLinkUrl": "" },
    "legal": { "privacyPolicyUrl": "", "termsUrl": "", "refundPolicyUrl": "" }
  },
  "meta": null
}
```

`payments.enabled` is true only when the payment module is on **and** a gateway is ready. No key, secret,
merchant id or webhook secret is ever part of this response.

`GET /api/v1/app/config/check-update?version=1.1.0` with latest `1.5.0`, minimum `1.2.0`:

```json
{ "success": true, "message": "OK", "data": { "platform": "android", "installedVersion": "1.1.0", "latestVersion": "1.5.0", "minimumSupportedVersion": "1.2.0", "updateAvailable": true, "updateRequired": true, "forceUpdate": false, "message": "A new version of SafeRent is available. Please update to continue.", "playStoreUrl": "https://play.google.com/store/apps/details?id=com.saferent.app" }, "meta": null }
```

`updateRequired` = installed < minimum, or force update is on and installed < latest.

Errors the app must handle on **any** authenticated call:

| HTTP | `reason` | Meaning | App behaviour |
| --- | --- | --- | --- |
| 503 | `MAINTENANCE_MODE` | Maintenance is on (`details.title`, `details.expectedEndAt`) | Show the maintenance screen; re-check `/app/config` |
| 403 | `FEATURE_DISABLED` | Feature switched off (`details.feature`) | Hide the screen, refresh config |
| 403 | `LOGIN_METHOD_DISABLED` | Phone sign-in switched off | Show the message on the login screen |
| 400 | `INVALID_INPUT` | Upload too big / wrong format | Show the message (it names the limit) |

---

## 4. What the server enforces (never trusts the app)

| Setting | Enforced where |
| --- | --- |
| Maintenance mode (+ allowed roles, start time) | every protected API call (`protect()` → `enforceAppConfig`); Super Admin and roles in `allowedRoles` pass; `app_config.manage` holders can still reach `/admin/app-config` to switch it off |
| Feature switches | same middleware, by API path, for customer roles (landlord, tenant, agent, service provider); staff keep access to administer |
| Payment module | `POST /rent/:id/pay`, `POST /wallet/topups` |
| UPI / card / net banking | Razorpay checkout `method` options returned with each order |
| Document categories (agreement, electricity, tax, other) | document upload API; ownership proofs stay allowed for verification |
| Name for "Other" documents, default visibility, tenant notification | document upload API |
| Max photos / documents per property | photo and document upload APIs |
| Max file size, allowed formats | every upload (photos, documents, avatar, selfie) after content sniffing; hard server ceiling 25 MB |
| Phone login / phone OTP | `/auth/phone/complete`, `/auth/register` (customers only) |
| OTP expiry / resend wait / max attempts | email OTP issue + verify (staff second factor) |
| Notification categories | payment, document, agreement, property-assigned, maintenance notifications are skipped when switched off |
| Referral system | referral attribution at registration, `/referrals/*` |

Shown to the app only (no server action yet): email login / email OTP for customer apps, Google login,
chat, push on/off (push delivery isn't built yet), rent-due/overdue reminders (no reminder job yet),
convenience fee, referral minimum and eligibility text, support, UI and legal values.
Staff always sign in with email + code, whatever these switches say.

---

## 5. Android integration (Kotlin, MVVM, Compose)

Libraries: Retrofit + OkHttp, kotlinx.serialization, DataStore (Preferences), Coroutines/Flow, Hilt (optional).

### 5.1 Models

```kotlin
@Serializable data class Envelope<T>(val success: Boolean, val message: String? = null, val data: T? = null, val reason: String? = null)

@Serializable data class AppConfig(
    val configVersion: Int = 0,
    val app: AppInfo = AppInfo(),
    val maintenance: Maintenance = Maintenance(),
    val features: Features = Features(),
    val auth: AuthSettings = AuthSettings(),
    val properties: PropertySettings = PropertySettings(),
    val documents: DocumentSettings = DocumentSettings(),
    val notifications: NotificationSettings = NotificationSettings(),
    val payments: PaymentSettings = PaymentSettings(),
    val referrals: ReferralSettings = ReferralSettings(),
    val support: SupportSettings = SupportSettings(),
    val splash: SplashSettings = SplashSettings(),
    val onboarding: OnboardingSettings = OnboardingSettings(),
    val ui: UiSettings = UiSettings(),
    val legal: LegalSettings = LegalSettings(),
)
@Serializable data class SplashSettings(val version: String = "1.0", val enabled: Boolean = true, val title: String = "SafeRent", val description: String = "Verified homes. Honest renting.", val lightLogoUrl: String = "", val darkLogoUrl: String = "", val lottieUrl: String = "", val minDurationMs: Long = 1500)
@Serializable data class OnboardingSettings(val version: String = "1.0", val enabled: Boolean = false, val showOnce: Boolean = true, val skippable: Boolean = true, val skipButtonText: String = "Skip", val screens: List<OnboardingScreen> = emptyList())
@Serializable data class OnboardingScreen(val id: String, val title: String, val description: String = "", val buttonText: String = "Next", val mediaType: String = "NONE" /* NONE | IMAGE | VIDEO | LOTTIE */, val imageUrl: String = "", val videoUrl: String = "", val lottieUrl: String = "")
// Only the URL matching mediaType is filled (IMAGE → imageUrl, VIDEO → videoUrl, LOTTIE → lottieUrl); the other two are "".
@Serializable data class AppInfo(val name: String = "SafeRent", val latestVersion: String = "1.0.0", val minimumSupportedVersion: String = "1.0.0", val forceUpdate: Boolean = false, val updateMessage: String = "", val playStoreUrl: String = "")
@Serializable data class Maintenance(val enabled: Boolean = false, val title: String = "", val message: String = "", val startsAt: String? = null, val expectedEndAt: String? = null)
@Serializable data class Features(val properties: Boolean = true, val tenants: Boolean = true, val landlords: Boolean = true, val rentManagement: Boolean = true, val rentPayments: Boolean = true, val rentReminders: Boolean = true, val documents: Boolean = true, val rentalAgreements: Boolean = true, val electricityBills: Boolean = true, val propertyTaxDocuments: Boolean = true, val otherDocuments: Boolean = true, val notifications: Boolean = true, val referrals: Boolean = true, val support: Boolean = true, val chat: Boolean = false)
@Serializable data class DocumentSettings(val agreement: Boolean = true, val electricityBill: Boolean = true, val propertyTax: Boolean = true, val otherDocuments: Boolean = true, val customNameRequired: Boolean = true, val maxFileSizeMB: Int = 10, val allowedFormats: List<String> = listOf("pdf", "jpg", "jpeg", "png"), val notifyTenantOnUpload: Boolean = true, val defaultVisibility: String = "PRIVATE")
@Serializable data class UiSettings(val primaryColor: String = "#F97316", val secondaryColor: String = "#111827", val accentColor: String = "#FB923C", val logoUrl: String = "", val darkMode: Boolean = true, val announcementEnabled: Boolean = false, val announcementTitle: String = "", val announcementMessage: String = "", val bannerEnabled: Boolean = false, val bannerImageUrl: String = "", val bannerLinkUrl: String = "")
@Serializable data class AuthSettings(val emailLogin: Boolean = true, val phoneLogin: Boolean = true, val emailOtp: Boolean = true, val phoneOtp: Boolean = true, val googleLogin: Boolean = false, val otpExpiryMinutes: Int = 5, val otpResendSeconds: Int = 60, val otpMaxAttempts: Int = 5, val showDemographics: Boolean = true, val demographicsSkippable: Boolean = true)
// PropertySettings, NotificationSettings, PaymentSettings, ReferralSettings,
// SupportSettings, LegalSettings: same field names as the JSON in section 3, each with a default.

@Serializable data class UpdateCheck(val installedVersion: String, val latestVersion: String, val minimumSupportedVersion: String, val updateAvailable: Boolean, val updateRequired: Boolean, val message: String = "", val playStoreUrl: String = "")
```

Use `Json { ignoreUnknownKeys = true; coerceInputValues = true }` so new server fields never crash old apps.

### 5.2 Splash and onboarding flow

```
App start
 ├─ system splash (core-splashscreen, bundled logo) while the cached config loads (DataStore, instant)
 ├─ splash.enabled ?
 │    yes → branded splash: logo = dark theme ? (darkLogoUrl ‖ lightLogoUrl) : lightLogoUrl (empty = bundled logo), title, description,
 │          splash.lottieUrl as the loading animation (empty/failed = default progress indicator);
 │          stays ≥ splash.minDurationMs and until startup (config refresh, update check, auth) is done
 │    no  → only the system splash
 ├─ onboarding.enabled && screens not empty
 │      && !(onboarding.showOnce && DataStore "onboarding_seen_version" == onboarding.version) ?
 │    yes → pager of onboarding.screens in order: media (IMAGE → Coil AsyncImage, VIDEO → ExoPlayer muted
 │          loop, LOTTIE → lottie-compose from URL, NONE → no media), title, description, dots;
 │          "Skip" only when onboarding.skippable; "Get started" on the last screen
 │          → save onboarding.version as seen → continue
 └─ sign-in / registration / home (normal auth decision)
```

- Media can be uploaded in the admin page (stored by the API, served from `GET /api/v1/app/assets/{file}` —
  public, cached for a year) or be any https:// link. The config always gives the app a **full URL**
  (uploaded files are built from the host the app called, e.g. `http://192.168.1.46:4000/api/v1/app/assets/….json`
  in development, the production API domain in production).
- Images (light / dark splash logos, onboarding IMAGE) are PNG, JPG or WEBP — **SVG is not supported**
  (uploads and https links ending in .svg are refused). Load them with Coil `AsyncImage`.
- Media is optional; always show a placeholder and never block the flow
  when a URL fails (offline, 404) — fall back to text-only.
- Use the cached config on the very first frame; refresh in the background (ETag). New slides apply on the next start.
- `splash.version` and `onboarding.version` are maintained by the server as "major.minor" strings:
  "1.0" → "1.1" … "1.9" → "2.0" on every save that changes that section (including a rollback).
  Compare them for equality (string), not as numbers. Use them to decide when to re-download splash media and when
  "show once" onboarding must be shown again (store the last seen `onboarding.version` in DataStore).

### 5.3 Sign-in → user profile screen

```
Login screen: [x] I agree to the Terms of Service and Privacy Policy (required)  [ ] WhatsApp updates (optional)
OTP verified → POST /api/v1/auth/phone/complete { fcmToken, platform: "ANDROID", appVersion }   ← saves the FCM token
   ← { registrationRequired, isProfileCompleted, missingFields, termsAccepted, fcmTokenSaved }
 ├─ isProfileCompleted = true  → open the dashboard of the user's role (GET /auth/me → user.role / roles)
 └─ false → user profile screen (if auth.showDemographics; "Skip" only for existing accounts when auth.demographicsSkippable)
       → POST /api/v1/userProfile   (ONE call for first-time AND existing users; PUT also works)
         { isProfileCompleted: true, role: "TENANT", fullName, gender, dateOfBirth, city, state, email?, occupation?, referralCode?,
           consents: [ {type:"TERMS",version:<legal.termsVersion>,granted:true}, {type:"PRIVACY",version:<legal.privacyVersion>,granted:true},
                       {type:"WHATSAPP",version:"",granted:<checkbox>} ],
           clientAcceptedAt: <epoch ms>, source: "ANDROID", appVersion: "1.0" }
       ← 201 (account created) / 200: { user, isProfileCompleted, missingFields, role, roles, termsAccepted, consents }
       → open the dashboard of `role`; save it as the active role in DataStore
```
- A first-time account must accept TERMS + PRIVACY (400 otherwise). Consents are stored append-only in user_consents.
- `role` is required on every save; an existing account that lacks it gets it as an additional role.
- Skip for existing users: `{ isProfileCompleted: false, role: <current role> }`.
- FCM token rotated (onNewToken) → PUT /api/v1/devices/fcm-token { fcmToken, platform, appVersion }.
  Logout → POST /api/v1/auth/logout { fcmToken } removes it.

### 5.4 API

```kotlin
interface AppConfigApi {
    @GET("api/v1/app/config")
    suspend fun config(@Header("If-None-Match") etag: String?): Response<Envelope<AppConfig>>

    @GET("api/v1/app/config/version")
    suspend fun version(): Envelope<ConfigVersion>

    @GET("api/v1/app/config/check-update")
    suspend fun checkUpdate(@Query("version") version: String, @Query("platform") platform: String = "android"): Envelope<UpdateCheck>
}
@Serializable data class ConfigVersion(val configVersion: Int, val updatedAt: String? = null)
```

Authenticated calls (not needed for the config endpoints) add the Firebase ID token:

```kotlin
class AuthInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): okhttp3.Response {
        val token = runBlocking { FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token }
        val req = chain.request().newBuilder().apply { if (token != null) header("Authorization", "Bearer $token") }.build()
        return chain.proceed(req)
    }
}
```

### 5.5 Cache (DataStore)

```kotlin
private val Context.configStore by preferencesDataStore("app_config")

class AppConfigCache(private val context: Context, private val json: Json) {
    private val BODY = stringPreferencesKey("body")
    private val ETAG = stringPreferencesKey("etag")

    val config: Flow<AppConfig> = context.configStore.data
        .catch { emit(emptyPreferences()) }
        .map { p -> p[BODY]?.let { runCatching { json.decodeFromString<AppConfig>(it) }.getOrNull() } ?: AppConfig() }

    suspend fun etag(): String? = context.configStore.data.first()[ETAG]
    suspend fun save(cfg: AppConfig, etag: String?) = context.configStore.edit {
        it[BODY] = json.encodeToString(cfg); if (etag != null) it[ETAG] = etag
    }
}
```

`AppConfig()` (all defaults) is the offline fallback on a fresh install with no network.

### 5.6 Repository

```kotlin
class AppConfigRepository(private val api: AppConfigApi, private val cache: AppConfigCache) {
    /** Always emits: cached (or default) config first, then fresh values after each refresh. */
    val config: Flow<AppConfig> = cache.config.distinctUntilChanged()

    /** Call on app start, on resume (at most every 5 minutes) and after a FEATURE_DISABLED / MAINTENANCE_MODE error. */
    suspend fun refresh(): Result<Unit> = runCatching {
        val res = api.config(cache.etag())
        when {
            res.code() == 304 -> Unit                                   // unchanged
            res.isSuccessful -> res.body()?.data?.let { cache.save(it, res.headers()["ETag"]) }
            else -> error("HTTP ${res.code()}")
        }
    }

    suspend fun checkUpdate(installed: String): UpdateCheck? = runCatching { api.checkUpdate(installed).data }.getOrNull()
}
```

Failures keep the last good config; never block the app on a config error.

### 5.7 ViewModel + Compose

```kotlin
sealed interface StartupState {
    data object Loading : StartupState
    data class Maintenance(val title: String, val message: String, val until: String?) : StartupState
    data class ForceUpdate(val message: String, val playStoreUrl: String) : StartupState
    data class Ready(val config: AppConfig, val softUpdate: UpdateCheck?) : StartupState
}

class AppConfigViewModel(private val repo: AppConfigRepository) : ViewModel() {
    private val update = MutableStateFlow<UpdateCheck?>(null)
    val config = repo.config.stateIn(viewModelScope, SharingStarted.Eagerly, AppConfig())

    val startup: StateFlow<StartupState> = combine(repo.config, update) { cfg, upd ->
        when {
            cfg.maintenance.enabled -> StartupState.Maintenance(cfg.maintenance.title, cfg.maintenance.message, cfg.maintenance.expectedEndAt)
            upd?.updateRequired == true -> StartupState.ForceUpdate(upd.message, upd.playStoreUrl)
            else -> StartupState.Ready(cfg, upd?.takeIf { it.updateAvailable })
        }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, StartupState.Loading)

    init { viewModelScope.launch { repo.refresh(); update.value = repo.checkUpdate(BuildConfig.VERSION_NAME) } }
    fun refresh() = viewModelScope.launch { repo.refresh() }
}

@Composable
fun SafeRentRoot(vm: AppConfigViewModel = hiltViewModel()) {
    val state by vm.startup.collectAsStateWithLifecycle()
    when (val s = state) {
        StartupState.Loading -> SplashScreen()
        is StartupState.Maintenance -> MaintenanceScreen(s.title, s.message, s.until, onRetry = vm::refresh)
        is StartupState.ForceUpdate -> ForceUpdateScreen(s.message, s.playStoreUrl)
        is StartupState.Ready -> SafeRentTheme(primary = Color(android.graphics.Color.parseColor(s.config.ui.primaryColor))) {
            AppNavHost(features = s.config.features)               // hide tabs/screens whose feature is off
            if (s.softUpdate != null) UpdateAvailableSnackbar(s.softUpdate)
        }
    }
}
```

Use the config, don't hardcode: upload pickers read `documents.allowedFormats` / `maxFileSizeMB` and
`properties.maxImages`; the OTP screen uses `auth.otpResendSeconds`; Help reads `support.*`; links read `legal.*`;
document-type pickers show only `documents.agreement / electricityBill / propertyTax / otherDocuments` that are true;
property-type pickers show `properties.enabledTypes`.

The app's flags only shape the UI. The server re-checks every one of them, so a modified app gains nothing.

---

## 6. Admin panel

Administration → **App configuration** (`/admin/app-config`):
- one tab per section (App information, Maintenance, Features, Authentication, Properties, Documents,
  Notifications, Payments, Referrals, Support, Splash screen, Onboarding, Branding & UI, Legal) + **History**;
- **Splash screen**: on/off, title, description, logo and Lottie loading animation (upload a file or paste
  an https link; separate light-theme and dark-theme logos, PNG/JPG/WEBP ≤ 5 MB, Lottie JSON ≤ 5 MB), minimum duration;
- **Onboarding**: on/off, show once, allow skip, and any number of screens (up to 10) — add, edit,
  reorder (↑ ↓), remove; each screen has title, description and media (none / image / video MP4 ≤ 25 MB / Lottie —
  uploaded or an https URL; uploads are checked by content, not just the file name)
  with a live preview for images and videos;
- toggles, inputs, dropdowns, colour pickers, multi-select formats and roles;
- "Changed" markers, Discard, and Save with a confirmation listing every change — important changes
  (maintenance, force update, minimum version, login, payments, core features) are called out;
- version number, last changed time and editor in the header;
- History with View (full JSON) and Restore (rollback, with an optional reason);
- property types, payment gateways and referral programs are shown read-only with links to their own pages.

Grant `app_config.manage` to another role in **Roles & permissions** to let them use it.

### 5.4 Blocked accounts (deleted / deactivated / suspended)

After the Firebase OTP succeeds, `POST /api/v1/auth/phone/complete` is the account check.

- `200` → `data.accountStatus` is `"ACTIVE"` → continue (`registrationRequired` / `isProfileCompleted` as before).
- `403` with `errorCode`:
  - `ACCOUNT_DELETED` — deleted by SafeRent. The phone number can't sign up again.
  - `ACCOUNT_DISABLED` — `details.accountStatus` is `DEACTIVATED` or `SUSPENDED` (staff can re-activate).

```json
{
  "success": false,
  "message": "This account has been deleted by SafeRent and can no longer be used.",
  "errorCode": "ACCOUNT_DELETED",
  "reason": "ACCOUNT_DELETED",
  "details": {
    "accountStatus": "DELETED",
    "title": "Account deleted",
    "reason": "Fake listings reported by several tenants",
    "at": "2026-11-14T10:32:05.120Z",
    "support": { "email": "support@saferenttechnologies.com", "phone": "+91…", "whatsapp": "+91…", "helpCenterUrl": "https://…" }
  },
  "data": null
}
```

The same 403 can come from `GET /auth/me`, `POST /userProfile` and any signed-in API (an account blocked
while the app is open). On it: keep the Firebase sign-in and session, and show the "account unavailable" screen
(title, message, reason, date) with **Try again**, **Contact support** (`details.support`) and **Back to home**.

Server rules behind this (for reference):
- Delete / deactivate / suspend only change `users.account_status` (+ reason, date). Nothing is revoked: the
  Firebase user, tokens and sessions stay. Every request is refused by the account gate instead.
- Re-activate / Restore set the status back to ACTIVE. The user does NOT sign in again: the app's
  **Try again** calls `POST /auth/phone/complete` with the same token → 200 → dashboard / user profile.
  (phone/complete answers 200 for an already signed-in session without asking for a fresh OTP.)
- So on this 403 the app must NOT sign out of Firebase or clear the session — just show the screen.
- "Force sign-out" (admin, security only) revokes tokens and sessions; then the app gets 401 and goes to login.
- The status check runs in `authenticate`, right after the ID token is verified and before any route logic or
  other auth error, so a blocked account always gets this 403 (even with a revoked token) instead of a 401.
- With no account for the Firebase uid, a phone sign-in is matched by the phone number in our DB
  (and by a deleted account's phone hash), so a re-created Firebase user still gets the 403.
- `POST /auth/logout` is the only signed-in route without the gate, so a blocked app can still remove its FCM token.

## 6. Search suggestions (tenant search)

`GET /api/v1/browse/locations?q=h&limit=8` (signed in) · `GET /api/v1/public/locations?q=h` (no login)

Places come from the addresses landlords entered (stored in the `locations` table) — only places with
live listings. Cities first, then areas, then states; most listings first.

```json
{ "success": true, "data": { "items": [
  { "kind": "CITY", "name": "Hyderabad", "city": null, "state": "Telangana", "label": "Hyderabad, Telangana",
    "listingCount": 42, "filters": { "city": "Hyderabad", "state": "Telangana" } },
  { "kind": "CITY", "name": "Hanumakonda", "city": null, "state": "Telangana", "label": "Hanumakonda, Telangana",
    "listingCount": 6, "filters": { "city": "Hanumakonda", "state": "Telangana" } },
  { "kind": "LOCALITY", "name": "Hitech City", "city": "Hyderabad", "state": "Telangana", "label": "Hitech City, Hyderabad",
    "listingCount": 9, "filters": { "locality": "Hitech City", "city": "Hyderabad", "state": "Telangana" } }
] } }
```

On tap, send `filters` as query parameters to `GET /api/v1/browse` (`city`, `locality`, `state`).
Debounce typing (~250 ms); one character is enough.
