# ⚠️ DEPRECATED - Siehe persistence-and-caching-proposal.md

Dieses Dokument wurde mit `persistence-interface-proposal.md` zu einem konsolidierten Dokument zusammengeführt: **`persistence-and-caching-proposal.md`**

---

# Application Loader Cache - Analyse und Vorschläge

## Aktueller Zustand

### Performance-Probleme

1. **`getAllAppNames()`** wird bei jedem Aufruf ausgeführt:
   - Liest beide Verzeichnisse (`json` und `local`) vom Dateisystem
   - Führt `readdirSync`, `existsSync` und `statSync` für jedes Verzeichnis aus
   - Wird mehrfach aufgerufen: `listApplications()`, `lxc-exec.mts`, Dokumentations-Generatoren, etc.

2. **`listApplications()`** ist sehr teuer:
   - Ruft `getAllAppNames()` auf (Dateisystem-Zugriff)
   - Für jede Application wird `readApplicationJson()` aufgerufen:
     - Liest und validiert `application.json`
     - Verarbeitet Inheritance (rekursiv)
     - Lädt Icons (Base64-Kodierung)
     - Verarbeitet Templates
   - Bei 50 Applications = 50+ Dateisystem-Zugriffe pro API-Request

3. **API-Endpunkt `/api/applications`**:
   - Wird bei jedem Seitenaufruf der Applications-Liste aufgerufen
   - Keine Caching-Mechanismen vorhanden

## Vorschläge für Optimierung

### Strategie 1: Zwei-Ebenen-Cache (Empfohlen)

#### Ebene 1: Cache für `getAllAppNames()`

**Konzept:**
- **JSON-Verzeichnis (read-only)**: Statischer Cache, wird nur beim Start geladen
- **Local-Verzeichnis (mutable)**: Cache mit Invalidation bei Änderungen

**Implementierung:**
```typescript
class ApplicationCache {
  private jsonAppsCache: Map<string, string> | null = null;
  private localAppsCache: Map<string, string> | null = null;
  private localAppsCacheTimestamp: number = 0;
  
  // File watcher für local-Verzeichnis
  private localWatcher?: FSWatcher;
  
  getAllAppNames(): Map<string, string> {
    // JSON-Verzeichnis: Einmalig laden
    if (this.jsonAppsCache === null) {
      this.jsonAppsCache = this.scanDirectory(this.pathes.jsonPath);
    }
    
    // Local-Verzeichnis: Prüfen ob Cache noch gültig
    const localDir = path.join(this.pathes.localPath, "applications");
    if (this.localAppsCache === null || this.hasLocalChanged(localDir)) {
      this.localAppsCache = this.scanDirectory(this.pathes.localPath);
      this.localAppsCacheTimestamp = Date.now();
    }
    
    // Merge: Local hat Priorität
    const result = new Map(this.jsonAppsCache);
    for (const [name, appPath] of this.localAppsCache) {
      result.set(name, appPath);
    }
    return result;
  }
  
  invalidateLocalCache(): void {
    this.localAppsCache = null;
  }
}
```

**Vorteile:**
- JSON-Verzeichnis wird nur einmal gelesen (sehr schnell)
- Local-Verzeichnis wird nur bei Änderungen neu gescannt
- Einfache Implementierung

**Nachteile:**
- File Watching benötigt zusätzliche Bibliothek (z.B. `chokidar`)
- Oder: Timestamp-basierte Prüfung (weniger genau, aber einfacher)

#### Ebene 2: Cache für `listApplications()`

**Konzept:**
- Vollständige Application-Liste cachen
- Invalidation nur bei Änderungen im `local` Verzeichnis
- Optional: Versionierung mit Timestamps

**Implementierung:**
```typescript
class ApplicationListCache {
  private cachedList: IApplicationWeb[] | null = null;
  private cacheTimestamp: number = 0;
  private localAppsSnapshot: Map<string, number> = new Map(); // name -> mtime
  
  listApplications(): IApplicationWeb[] {
    // Prüfen ob Cache noch gültig
    if (this.cachedList === null || this.hasLocalApplicationsChanged()) {
      this.cachedList = this.buildApplicationList();
      this.updateLocalAppsSnapshot();
      this.cacheTimestamp = Date.now();
    }
    return this.cachedList;
  }
  
  private hasLocalApplicationsChanged(): boolean {
    const localAppsDir = path.join(this.pathes.localPath, "applications");
    if (!existsSync(localAppsDir)) return false;
    
    const currentApps = this.scanLocalApplications();
    // Prüfe ob Anzahl sich geändert hat
    if (currentApps.size !== this.localAppsSnapshot.size) return true;
    
    // Prüfe ob mtime sich geändert hat
    for (const [name, mtime] of this.localAppsSnapshot) {
      const currentMtime = currentApps.get(name);
      if (currentMtime === undefined || currentMtime !== mtime) {
        return true;
      }
    }
    return false;
  }
  
  invalidateCache(): void {
    this.cachedList = null;
    this.localAppsSnapshot.clear();
  }
}
```

**Vorteile:**
- Sehr schnelle Antwortzeiten nach erstem Aufruf
- Automatische Invalidation bei Änderungen
- Reduziert Dateisystem-Zugriffe drastisch

**Nachteile:**
- Initialer Aufbau kann etwas dauern (aber nur einmal)
- Benötigt mtime-Tracking oder File Watcher

### Strategie 2: File Watching (Erweiterte Option)

**Konzept:**
- Verwendung von `chokidar` oder Node.js `fs.watch` für das `local` Verzeichnis
- Automatische Cache-Invalidation bei Dateiänderungen

#### Option 2a: Mit chokidar (Externe Bibliothek)

**Implementierung:**
```typescript
import chokidar from 'chokidar';

class ApplicationCacheWithWatcher {
  private watcher?: chokidar.FSWatcher;
  
  initWatcher(): void {
    const localAppsDir = path.join(this.pathes.localPath, "applications");
    this.watcher = chokidar.watch(localAppsDir, {
      ignored: /(^|[\/\\])\../, // Ignore dotfiles
      persistent: true,
      depth: 2, // Watch application.json files
    });
    
    this.watcher.on('add', () => this.invalidateLocalCache());
    this.watcher.on('change', () => this.invalidateLocalCache());
    this.watcher.on('unlink', () => this.invalidateLocalCache());
  }
}
```

**Vorteile:**
- Sofortige Reaktion auf Änderungen
- Keine Polling-Overhead
- Gut getestet, plattformübergreifend

**Nachteile:**
- Zusätzliche Abhängigkeit (`chokidar`)
- Komplexere Implementierung

#### Option 2b: Mit Node.js fs.watch (Native, keine Abhängigkeit)

**Implementierung mit fs.watch:**

```typescript
import { watch, FSWatcher } from 'fs';
import { watch as watchRecursive } from 'fs/promises'; // Node.js 20.11.0+
import path from 'path';

class ApplicationCacheWithFsWatch {
  private watcher?: FSWatcher;
  private recursiveWatcher?: AsyncIterator<{ eventType: string; filename: string }>;
  private invalidateTimeout?: NodeJS.Timeout;
  private readonly DEBOUNCE_MS = 500; // Debounce für mehrere Events
  
  /**
   * Initialisiert File Watching für das local-Verzeichnis
   * Überwacht rekursiv alle Änderungen in applications/
   */
  initWatcher(): void {
    const localAppsDir = path.join(this.pathes.localPath, "applications");
    
    // Prüfen ob Verzeichnis existiert
    if (!fs.existsSync(localAppsDir)) {
      console.warn(`Local applications directory does not exist: ${localAppsDir}`);
      return;
    }
    
    // Option 1: Node.js 20.11.0+ mit rekursivem watch
    if (typeof watchRecursive === 'function') {
      this.initRecursiveWatcher(localAppsDir);
    } else {
      // Option 2: Fallback für ältere Node.js Versionen
      this.initLegacyWatcher(localAppsDir);
    }
  }
  
  /**
   * Moderne Implementierung mit fs.watch (rekursiv, Node.js 20.11.0+)
   */
  private async initRecursiveWatcher(localAppsDir: string): Promise<void> {
    try {
      this.recursiveWatcher = watchRecursive(localAppsDir, { recursive: true });
      
      // Async Iterator für Events
      (async () => {
        for await (const event of this.recursiveWatcher!) {
          // Nur auf application.json und Verzeichnis-Änderungen reagieren
          if (this.isRelevantChange(event.filename)) {
            this.debouncedInvalidate();
          }
        }
      })().catch((err) => {
        console.error('Error in recursive watcher:', err);
      });
    } catch (err) {
      console.error('Failed to initialize recursive watcher:', err);
      // Fallback auf Legacy-Methode
      this.initLegacyWatcher(localAppsDir);
    }
  }
  
  /**
   * Legacy-Implementierung für ältere Node.js Versionen
   * Überwacht nur das Hauptverzeichnis, nicht rekursiv
   */
  private initLegacyWatcher(localAppsDir: string): void {
    this.watcher = watch(
      localAppsDir,
      { recursive: false },
      (eventType: string, filename: string | null) => {
        if (filename && this.isRelevantChange(filename)) {
          this.debouncedInvalidate();
          
          // Wenn ein Verzeichnis hinzugefügt wurde, auch dieses überwachen
          if (eventType === 'rename' && filename) {
            const fullPath = path.join(localAppsDir, filename);
            // Prüfen ob es ein Verzeichnis ist
            fs.stat(fullPath, (err, stats) => {
              if (!err && stats.isDirectory()) {
                // Rekursiv auch dieses Verzeichnis überwachen
                this.watchApplicationDirectory(fullPath);
              }
            });
          }
        }
      }
    );
    
    // Initial: Alle existierenden Application-Verzeichnisse überwachen
    this.watchAllExistingApplications(localAppsDir);
  }
  
  /**
   * Überwacht ein einzelnes Application-Verzeichnis
   */
  private watchApplicationDirectory(appDir: string): void {
    const appJsonPath = path.join(appDir, 'application.json');
    
    // Überwache application.json direkt
    if (fs.existsSync(appJsonPath)) {
      watch(appJsonPath, (eventType: string) => {
        if (eventType === 'change' || eventType === 'rename') {
          this.debouncedInvalidate();
        }
      });
    }
    
    // Überwache auch Icon-Änderungen
    const iconPath = path.join(appDir, 'icon.png');
    if (fs.existsSync(iconPath)) {
      watch(iconPath, (eventType: string) => {
        if (eventType === 'change' || eventType === 'rename') {
          this.debouncedInvalidate();
        }
      });
    }
  }
  
  /**
   * Überwacht alle bereits existierenden Applications
   */
  private watchAllExistingApplications(localAppsDir: string): void {
    try {
      const entries = fs.readdirSync(localAppsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const appDir = path.join(localAppsDir, entry.name);
          this.watchApplicationDirectory(appDir);
        }
      }
    } catch (err) {
      console.error('Error watching existing applications:', err);
    }
  }
  
  /**
   * Prüft ob eine Änderung relevant ist (application.json, Icons, Verzeichnis-Änderungen)
   */
  private isRelevantChange(filename: string | null): boolean {
    if (!filename) return false;
    
    // Ignoriere versteckte Dateien
    if (filename.startsWith('.')) return false;
    
    // Relevante Dateien/Verzeichnisse
    return (
      filename.endsWith('application.json') ||
      filename.endsWith('icon.png') ||
      filename.endsWith('icon.svg') ||
      // Verzeichnis-Änderungen (wenn filename ein Verzeichnisname ist)
      !filename.includes('.')
    );
  }
  
  /**
   * Debounced Cache-Invalidation
   * Verhindert zu häufige Cache-Invalidierungen bei mehreren Events
   */
  private debouncedInvalidate(): void {
    if (this.invalidateTimeout) {
      clearTimeout(this.invalidateTimeout);
    }
    
    this.invalidateTimeout = setTimeout(() => {
      this.invalidateLocalCache();
      this.invalidateTimeout = undefined;
    }, this.DEBOUNCE_MS);
  }
  
  /**
   * Invalidiert den Local-Cache
   */
  private invalidateLocalCache(): void {
    this.localAppsCache = null;
    this.applicationsListCache = null;
    console.log('Application cache invalidated due to file system change');
  }
  
  /**
   * Stoppt das File Watching
   */
  closeWatcher(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    
    if (this.invalidateTimeout) {
      clearTimeout(this.invalidateTimeout);
      this.invalidateTimeout = undefined;
    }
    
    // Recursive watcher wird automatisch geschlossen wenn der Iterator beendet wird
    this.recursiveWatcher = undefined;
  }
}
```

**Wichtige Überlegungen für fs.watch:**

1. **Rekursives Watching:**
   - Node.js 20.11.0+ unterstützt rekursives `fs.watch()` nativ
   - Ältere Versionen benötigen manuelles Watching pro Verzeichnis

2. **Event-Debouncing:**
   - `fs.watch` kann mehrere Events für eine einzelne Dateiänderung auslösen
   - Debouncing verhindert zu häufige Cache-Invalidierungen

3. **Plattform-Unterschiede:**
   - Auf macOS kann `fs.watch` manchmal doppelte Events auslösen
   - Auf Linux funktioniert es sehr zuverlässig
   - Windows benötigt manchmal zusätzliche Konfiguration

4. **Performance:**
   - Rekursives Watching kann bei vielen Dateien Performance-Probleme verursachen
   - Besser: Nur `application.json` und Icons überwachen, nicht alle Templates

5. **Fehlerbehandlung:**
   - `fs.watch` kann fehlschlagen (z.B. wenn Verzeichnis gelöscht wird)
   - Fehlerbehandlung und Reconnection-Logik erforderlich

**Vorteile von fs.watch:**
- Keine externe Abhängigkeit
- Native Node.js API
- Geringer Overhead

**Nachteile von fs.watch:**
- Plattform-spezifische Unterschiede
- Rekursives Watching erst ab Node.js 20.11.0
- Komplexere Fehlerbehandlung erforderlich
- Kann bei vielen Dateien Performance-Probleme haben

#### Vereinfachte fs.watch Implementierung (Empfohlen für Start)

Für die meisten Fälle reicht eine einfachere Implementierung:

```typescript
import { watch, FSWatcher } from 'fs';
import path from 'path';

class SimpleApplicationCacheWatcher {
  private watcher?: FSWatcher;
  private invalidateTimeout?: NodeJS.Timeout;
  private readonly DEBOUNCE_MS = 300;
  
  /**
   * Einfache Implementierung: Überwacht nur das Hauptverzeichnis
   * und reagiert auf Verzeichnis-Änderungen (add/remove von Applications)
   */
  initWatcher(localAppsDir: string, onInvalidate: () => void): void {
    if (!fs.existsSync(localAppsDir)) {
      return;
    }
    
    this.watcher = watch(
      localAppsDir,
      { recursive: false },
      (eventType: string, filename: string | null) => {
        // Nur auf Verzeichnis-Änderungen reagieren (neue/gelöschte Applications)
        if (filename && !filename.includes('.')) {
          // Debounce für mehrere Events
          if (this.invalidateTimeout) {
            clearTimeout(this.invalidateTimeout);
          }
          this.invalidateTimeout = setTimeout(() => {
            onInvalidate();
          }, this.DEBOUNCE_MS);
        }
      }
    );
    
    // Zusätzlich: Überwache application.json Dateien direkt
    this.watchApplicationJsonFiles(localAppsDir, onInvalidate);
  }
  
  /**
   * Überwacht alle application.json Dateien in existierenden Applications
   */
  private watchApplicationJsonFiles(localAppsDir: string, onInvalidate: () => void): void {
    try {
      const entries = fs.readdirSync(localAppsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const appJsonPath = path.join(localAppsDir, entry.name, 'application.json');
          if (fs.existsSync(appJsonPath)) {
            watch(appJsonPath, () => {
              // Debounced invalidation
              if (this.invalidateTimeout) {
                clearTimeout(this.invalidateTimeout);
              }
              this.invalidateTimeout = setTimeout(() => {
                onInvalidate();
              }, this.DEBOUNCE_MS);
            });
          }
        }
      }
    } catch (err) {
      console.error('Error setting up application.json watchers:', err);
    }
  }
  
  close(): void {
    if (this.watcher) {
      this.watcher.close();
    }
    if (this.invalidateTimeout) {
      clearTimeout(this.invalidateTimeout);
    }
  }
}
```

**Verwendung in StorageContext:**

```typescript
export class StorageContext extends Context {
  private cacheWatcher?: SimpleApplicationCacheWatcher;
  
  constructor(...) {
    // ... existing code ...
    
    // Optional: File Watcher initialisieren
    if (process.env.ENABLE_FILE_WATCHING === 'true') {
      this.cacheWatcher = new SimpleApplicationCacheWatcher();
      const localAppsDir = path.join(this.pathes.localPath, "applications");
      this.cacheWatcher.initWatcher(localAppsDir, () => {
        this.invalidateApplicationCache();
      });
    }
  }
  
  invalidateApplicationCache(): void {
    this.appNamesCache.local = null;
    this.applicationsListCache = null;
  }
}
```

**Hinweis:** Da später ein UI kommt, das den Cache manuell invalidiert, ist File Watching optional. Die einfache mtime-basierte Prüfung reicht in den meisten Fällen aus.

### Strategie 3: Hybrid-Ansatz (Beste Balance)

**Kombination:**
1. **JSON-Verzeichnis**: Statischer Cache (wird nie invalidiert)
2. **Local-Verzeichnis**: 
   - Cache mit mtime-Tracking (einfach, zuverlässig)
   - Optional: File Watcher für sofortige Updates (wenn gewünscht)
3. **Application-Liste**: Cache mit Invalidation basierend auf Local-Änderungen

## Analyse: Was braucht die Frontend Application List?

**Frontend benötigt nur:**
- `name` - aus `application.json`
- `description` - aus `application.json`
- `icon`, `iconContent`, `iconType` - aus `application.json` + Icon-Datei
- `id` - Application-Name
- `errors` - Validierungsfehler aus `application.json` (ohne Templates!)

**Wichtig:** `readApplicationJson()` lädt **KEINE Template-Dateien**! Es:
- Liest nur `application.json` (inkl. Inheritance)
- Lädt Icons
- Verarbeitet Template-Referenzen (Namen) aus `application.json` für Validierung
- Lädt **NICHT** die Template-Dateien selbst

**Fazit:** Die Application-Liste ist **unabhängig von Template-Änderungen**! Template-Änderungen in `local/shared/templates/` betreffen nur den Template-Cache, nicht die Application-Liste.

## Empfohlene Implementierung

### Phase 1: Basis-Cache (Einfach, schnell umsetzbar)

1. **Umbenennung:** `getAllAppNames()` → `listApplicationsForFrontend()` oder `getApplicationListData()`
   - Liefert direkt `IApplicationWeb[]` statt `Map<string, string>`
   - JSON-Verzeichnis: Einmalig beim ersten Aufruf
   - Local-Verzeichnis: fs.watch für sofortige Invalidation

2. **Cache für Application-Liste:**
   - Vollständige Liste cachen
   - Invalidation nur bei Änderungen in `local/json/applications/`
   - **KEINE** Invalidation bei Template-Änderungen (nicht nötig!)

3. **fs.watch für local-Verzeichnis:**
   - Überwacht `local/json/applications/` rekursiv
   - Invalidiert Application-Cache bei Änderungen
   - Überwacht `local/json/shared/templates/` separat
   - Invalidiert Template-Cache bei Template-Änderungen (selten, daher gesamter Cache)

### Phase 2: Erweiterte Optimierung (Optional)

1. File Watcher für sofortige Updates
2. Lazy Loading von Icons (nur bei Bedarf laden)
3. Incremental Updates (nur geänderte Applications neu laden)

## Implementierungsdetails

### Cache-Struktur mit fs.watch

```typescript
import { watch, FSWatcher } from 'fs';
import path from 'path';

export class StorageContext extends Context {
  // Cache für Application-Liste (für Frontend)
  private applicationsListCache: IApplicationWeb[] | null = null;
  
  // Cache für Application-Namen (für andere Zwecke, z.B. lxc-exec)
  private appNamesCache: {
    json: Map<string, string> | null;
    local: Map<string, string> | null;
  } = {
    json: null,
    local: null,
  };
  
  // File Watchers
  private localAppsWatcher?: FSWatcher;
  private localTemplatesWatcher?: FSWatcher;
  private invalidateTimeout?: NodeJS.Timeout;
  private readonly DEBOUNCE_MS = 300;
  
  constructor(...) {
    // ... existing code ...
    
    // Initialize file watchers
    this.initFileWatchers();
  }
  
  /**
   * Initialisiert fs.watch für local-Verzeichnisse
   * Node.js 20.11.0+ unterstützt rekursives Watching nativ
   */
  private initFileWatchers(): void {
    const localAppsDir = path.join(this.pathes.localPath, "applications");
    const localTemplatesDir = path.join(this.pathes.localPath, "shared", "templates");
    
    // Watch local applications (rekursiv)
    if (fs.existsSync(localAppsDir)) {
      this.localAppsWatcher = watch(
        localAppsDir,
        { recursive: true },
        (eventType: string, filename: string | null) => {
          if (filename && this.isApplicationChange(filename)) {
            this.debouncedInvalidateApplicationCache();
          }
        }
      );
    }
    
    // Watch local shared templates (rekursiv)
    // Bei Template-Änderungen: gesamten Template-Cache invalidieren
    if (fs.existsSync(localTemplatesDir)) {
      this.localTemplatesWatcher = watch(
        localTemplatesDir,
        { recursive: true },
        (eventType: string, filename: string | null) => {
          if (filename && filename.endsWith('.json')) {
            // Template-Änderungen sind selten, invalidieren gesamten Template-Cache
            this.debouncedInvalidateTemplateCache();
          }
        }
      );
    }
  }
  
  /**
   * Prüft ob eine Änderung relevant für Applications ist
   */
  private isApplicationChange(filename: string): boolean {
    // Ignoriere versteckte Dateien
    if (filename.startsWith('.')) return false;
    
    // Relevante Änderungen:
    // - application.json
    // - icon.png/svg
    // - Verzeichnis-Änderungen (neue/gelöschte Applications)
    return (
      filename.endsWith('application.json') ||
      filename.endsWith('icon.png') ||
      filename.endsWith('icon.svg') ||
      !filename.includes('.') // Verzeichnis-Name
    );
  }
  
  /**
   * Debounced Invalidation für Application-Cache
   */
  private debouncedInvalidateApplicationCache(): void {
    if (this.invalidateTimeout) {
      clearTimeout(this.invalidateTimeout);
    }
    this.invalidateTimeout = setTimeout(() => {
      this.applicationsListCache = null;
      this.appNamesCache.local = null;
      this.invalidateTimeout = undefined;
    }, this.DEBOUNCE_MS);
  }
  
  /**
   * Debounced Invalidation für Template-Cache
   * Wird bei Änderungen in local/shared/templates/ aufgerufen
   */
  private debouncedInvalidateTemplateCache(): void {
    // Template-Cache wird hier invalidiert
    // (wird in TemplateProcessor oder ähnlicher Klasse verwaltet)
    // Da Template-Änderungen selten sind, invalidieren wir den gesamten Cache
    console.log('Template cache invalidated due to change in local/shared/templates/');
  }
  
  /**
   * Liefert Application-Liste für Frontend
   * WICHTIG: Lädt KEINE Templates, nur application.json + Icons
   */
  listApplicationsForFrontend(): IApplicationWeb[] {
    // Cache prüfen (wird durch fs.watch invalidiert)
    if (this.applicationsListCache === null) {
      this.applicationsListCache = this.buildApplicationList();
    }
    return this.applicationsListCache;
  }
  
  /**
   * Baut Application-Liste auf (ohne Templates zu laden!)
   */
  private buildApplicationList(): IApplicationWeb[] {
    const applications: IApplicationWeb[] = [];
    
    // JSON-Verzeichnis: Einmalig laden
    if (this.appNamesCache.json === null) {
      this.appNamesCache.json = this.scanApplicationsDir(this.pathes.jsonPath);
    }
    
    // Local-Verzeichnis: Aus Cache (wird durch fs.watch invalidiert)
    if (this.appNamesCache.local === null) {
      this.appNamesCache.local = this.scanApplicationsDir(this.pathes.localPath);
    }
    
    // Merge: Local hat Priorität
    const allApps = new Map(this.appNamesCache.json);
    for (const [name, appPath] of this.appNamesCache.local) {
      allApps.set(name, appPath);
    }
    
    // Für jede Application: application.json laden (OHNE Templates!)
    for (const [applicationName, appPath] of allApps) {
      const readOpts: IReadApplicationOptions = {
        applicationHierarchy: [],
        error: new VEConfigurationError("", applicationName),
        taskTemplates: [], // Wird nur für Validierung verwendet, nicht geladen
      };
      const appLoader = new ApplicationLoader(this.pathes);
      try {
        let app = appLoader.readApplicationJson(applicationName, readOpts);
        app.description = app.description || "No description available";
        applications.push(app as IApplicationWeb);
      } catch (e: Error | any) {
        // Errors werden unten behandelt
      }
      if (readOpts.error.details && readOpts.error.details.length > 0 && applications.length > 0) {
        applications[applications.length - 1]!.errors = readOpts.error.details;
      }
    }
    
    return applications;
  }
  
  /**
   * Legacy-Methode für Rückwärtskompatibilität
   * Wird von lxc-exec und anderen Stellen verwendet
   */
  getAllAppNames(): Map<string, string> {
    // JSON: Einmalig laden
    if (this.appNamesCache.json === null) {
      this.appNamesCache.json = this.scanApplicationsDir(this.pathes.jsonPath);
    }
    
    // Local: Aus Cache (wird durch fs.watch invalidiert)
    if (this.appNamesCache.local === null) {
      this.appNamesCache.local = this.scanApplicationsDir(this.pathes.localPath);
    }
    
    // Merge
    const result = new Map(this.appNamesCache.json);
    for (const [name, appPath] of this.appNamesCache.local) {
      result.set(name, appPath);
    }
    return result;
  }
  
  /**
   * Manuelle Invalidation (z.B. nach Framework-Create via UI)
   */
  invalidateApplicationCache(): void {
    this.applicationsListCache = null;
    this.appNamesCache.local = null;
  }
  
  /**
   * Cleanup beim Shutdown
   */
  close(): void {
    if (this.localAppsWatcher) {
      this.localAppsWatcher.close();
    }
    if (this.localTemplatesWatcher) {
      this.localTemplatesWatcher.close();
    }
    if (this.invalidateTimeout) {
      clearTimeout(this.invalidateTimeout);
    }
  }
}
```

### Wichtige Punkte:

1. **`listApplicationsForFrontend()`** ersetzt `listApplications()`:
   - Liefert direkt `IApplicationWeb[]`
   - Lädt **KEINE Templates**, nur `application.json` + Icons
   - Wird durch fs.watch invalidiert (nur bei Application-Änderungen)

2. **fs.watch für local-Verzeichnisse:**
   - `local/json/applications/` → invalidiert Application-Cache
   - `local/json/shared/templates/` → invalidiert Template-Cache (separat)

3. **Template-Änderungen:**
   - Betreffen **NICHT** die Application-Liste
   - Invalidieren nur den Template-Cache (wird separat verwaltet)

4. **JSON-Verzeichnis:**
   - Wird nur einmal geladen (read-only, ändert sich nur durch Deploy)
   - Kein File Watching nötig

## Performance-Erwartungen

### Vorher (ohne Cache):
- `getAllAppNames()`: ~50-100ms (je nach Anzahl Applications)
- `listApplications()`: ~500-2000ms (je nach Anzahl und Komplexität)
- **Gesamt pro API-Request**: ~500-2000ms

### Nachher (mit Cache):
- `getAllAppNames()`: ~0.1ms (aus Cache)
- `listApplications()`: ~0.1ms (aus Cache, nach erstem Aufruf)
- **Gesamt pro API-Request**: ~0.1-0.5ms (nach erstem Aufruf)
- **Erster Aufruf**: ~500-2000ms (wie vorher)

**Verbesserung: 1000-10000x schneller** nach erstem Aufruf!

## Migration

1. Cache-Funktionalität zu `StorageContext` hinzufügen
2. Rückwärtskompatibel: Falls Cache fehlschlägt, Fallback auf alte Implementierung
3. Tests erweitern für Cache-Verhalten
4. Optional: File Watcher als Feature-Flag

## Zusammenfassung der Entscheidungen

1. **File Watching:** ✅ fs.watch für `local/json/applications/` und `local/json/shared/templates/`
   - Rekursives Watching (Node.js 20.11.0+)
   - Alpine Linux (Hauptplattform)
   - Keine externe Abhängigkeit nötig

2. **Cache-Strategie:**
   - **JSON-Verzeichnis:** Statischer Cache (einmalig geladen, ändert sich nur durch Deploy)
   - **Local Applications:** fs.watch für sofortige Invalidation
   - **Local Templates:** fs.watch, invalidiert gesamten Template-Cache (selten)

3. **Application-Liste:**
   - **Neue Methode:** `listApplicationsForFrontend()` statt `listApplications()`
   - **Lädt KEINE Templates** - nur `application.json` + Icons
   - **Unabhängig von Template-Änderungen** - wird nicht bei Template-Änderungen invalidiert

4. **Manuelle Invalidation:**
   - UI ruft `invalidateApplicationCache()` nach Create/Update/Delete
   - fs.watch als Backup für externe Änderungen

## Migration

1. `listApplications()` → `listApplicationsForFrontend()` umbenennen
2. fs.watch für local-Verzeichnisse implementieren
3. Template-Cache separat verwalten (nicht in StorageContext)
4. Tests erweitern für Cache-Verhalten und fs.watch

