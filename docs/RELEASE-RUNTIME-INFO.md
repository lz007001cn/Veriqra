# Release and runtime information

The ADMIN-only, read-only `/api/admin/system` endpoint provides release and deployment checks. Its response includes an allowlist of application version, build commit, UTC build time, application/database status, database version and table count, server time, application display time zone, and the existing non-secret runtime fields. It never returns database credentials, a JDBC URL, environment variables, filesystem paths, or full system properties. The administration UI contains user maintenance only; there is no System page.

Maven filters `build-info.properties` into `target/classes` and the WAR. The version comes from `project.version`; the full Git commit and UTC build time come from the Git commit ID Maven plugin at build time. Nothing generated is written to tracked source. When Git metadata is unavailable, the commit is `unknown`; unresolved or invalid metadata is also returned as `unknown` rather than a template expression. A release build must verify that the API's commit equals `git rev-parse HEAD` and recompute the WAR SHA-256 after packaging.

Database status `UP` means the ADMIN-authorized request successfully queried the database. If the database is unavailable, authentication/authorization may itself fail, so this endpoint cannot act as an independent outage monitor; it does not claim `DOWN` from cached data. Table count is an observable schema size, **not** a migration version. Build and server instants are returned in UTC; the application display time zone is reported separately as Asia/Shanghai.

The same API URL is relative to the WAR context, so ROOT and `/veriqra` deployments use identical behavior. Ordinary users receive the existing 403 response.
