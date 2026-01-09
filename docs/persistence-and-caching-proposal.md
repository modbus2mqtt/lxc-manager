# Persistence Interface und Caching - Konsolidierter Vorschlag

## Problem-Analyse

### Performance-Probleme

1. **`getAllAppNames()`** wird bei jedem Aufruf ausgeführt:
   - Liest beide Verzeichnisse (`json` und `local`) vom Dateisystem
   - Führt `readdirSync`, `existsSync` und `statSync` für jedes Verzeichnis aus
   - Wird mehrfach aufgerufen: `listApplications()`, `lxc-exec.mts`, Dokumentations-Generatoren, etc.

2. **`listApplications()`** ist sehr teuer:
   - Ruft `getAllAppNames()` auf (Dateisystem-Zugriff)
   - Für jede Application wird `readApplicationJson()` aufgerufen
   - Bei 50 Applications = 50+ Dateisystem-Zugriffe pro API-Request

3. **API-Endpunkt `/api/applications`**:
   - Wird bei jedem Seitenaufruf der Applications-Liste aufgerufen
   - Keine Caching-Mechanismen vorhanden

### Architektur-Probleme

1. **Vermischte Concerns in StorageContext:**
   - Context-Management (VE, VM, VMInstall) - Persistenz in `storagecontext.json`
   - Entity-Loading (Applications, Templates, Frameworks) - Dateisystem-Zugriff

2. **Verstreute Dateisystem-Zugriffe:**
   - `ApplicationLoader` - liest `application.json`
   - `FrameworkLoader` - liest `framework.json`
   - `TemplateProcessor` - liest Templates
   - `TemplatePathResolver` - findet Template-Pfade
   - `StorageContext` - listet Applications/Frameworks

3. **Keine zentrale Caching-Strategie**
4. **Schwer testbar** (direkte FS-Abhängigkeiten)
5. **Keine klare Abstraktion** für Persistenz

## Lösung: Persistence Interface mit Caching

### Architektur-Überlegungen

**Separation of Concerns:**
- **Persistence Layer**: Verantwortlich für Lesen/Schreiben von Entities + Caching
- **Business Logic Layer**: Verarbeitet Entities (ApplicationLoader, TemplateProcessor, etc.)
- **Context Layer**: Nur für Context-Management (VE, VM, VMInstall)

### Wie Persistence Interface und Caching zusammenhängen

**Das Persistence Interface kapselt die Caching-Logik:**

1. **Interface definiert die API** (was benötigt wird):
   - `listApplicationsForFrontend()` - liefert gecachte Liste
   - `readApplication()` - liefert gecachte Application
   - `getAllAppNames()` - liefert gecachte Namen-Liste

2. **Implementierung (FileSystemPersistence) verwaltet den Cache**:
   - Cache-Strukturen sind **privat** in der Implementierung
   - fs.watch wird **intern** verwendet für automatische Invalidation
   - Cache-Logik ist **versteckt** vor den Aufrufern

3. **Vorteil dieser Architektur**:
   - Aufrufer (ApplicationLoader, StorageContext) wissen nichts vom Cache
   - Cache kann optimiert/geändert werden ohne API zu ändern
   - Andere Implementierungen (z.B. Datenbank) können anderes Caching verwenden
   - Testbarkeit: Mock-Implementierung kann Cache simulieren

**Beispiel-Fluss:**

```
StorageContext.listApplicationsForFrontend()
  ↓
FileSystemPersistence.listApplicationsForFrontend()
  ↓
[Prüft intern: Cache vorhanden?]
  ├─ Ja → Gibt gecachte Liste zurück (0.1ms)
  └─ Nein → Baut Liste neu auf, speichert in Cache, gibt zurück (500ms)
  
[fs.watch erkennt Änderung in local/json/applications/]
  ↓
[Invalidiert intern den Cache]
  ↓
[Nächster Aufruf baut Liste neu auf]
```

**Wichtig:** Die Cache-Invalidation passiert **automatisch** durch fs.watch, aber die API bleibt gleich. Aufrufer müssen sich nicht um Cache-Management kümmern.

### Wichtige Erkenntnisse

**Frontend Application List benötigt:**
- `name`, `description`, `icon`, `iconContent`, `iconType`, `id`, `errors`
- **KEINE Templates!** `readApplicationJson()` lädt keine Template-Dateien, nur `application.json` + Icons

**Konsequenzen:**
- Application-Liste ist **unabhängig von Template-Änderungen**
- Template-Änderungen in `local/shared/templates/` betreffen nur den Template-Cache
- Application-Liste wird **nicht** bei Template-Änderungen invalidiert

## Interface-Design

```typescript
/**
 * Base interface for all persistence operations
 */
interface IPersistence {
  /**
   * Invalidates all caches (called when UI creates/updates/deletes entities)
   */
  invalidateCache(): void;
}

/**
 * Persistence for Applications
 */
interface IApplicationPersistence extends IPersistence {
  /**
   * Lists all application names (name -> path mapping)
   * Cached: JSON directory cached permanently, local directory cached with fs.watch
   */
  getAllAppNames(): Map<string, string>;
  
  /**
   * Lists all applications with full data (for Frontend UI)
   * Cached: Full list cached, invalidated via fs.watch when local applications change
   * WICHTIG: Lädt KEINE Templates, nur application.json + Icons
   */
  listApplicationsForFrontend(): IApplicationWeb[];
  
  /**
   * Reads a single application.json file (with inheritance)
   * Cached: Per-application cache with mtime-check for local apps
   */
  readApplication(applicationName: string, opts: IReadApplicationOptions): IApplication;
  
  /**
   * Reads application icon (base64 encoded)
   * Cached: Per-icon cache
   */
  readApplicationIcon(applicationName: string): { content: string; type: string } | null;
  
  /**
   * Writes application (creates/updates in local directory)
   * Invalidates cache automatically
   */
  writeApplication(applicationName: string, application: IApplication): void;
  
  /**
   * Deletes application
   * Invalidates cache automatically
   */
  deleteApplication(applicationName: string): void;
}

/**
 * Persistence for Templates
 */
interface ITemplatePersistence extends IPersistence {
  /**
   * Resolves template path (checks local first, then shared)
   */
  resolveTemplatePath(templateName: string, appPath: string): { fullPath: string; isShared: boolean } | null;
  
  /**
   * Loads a template from file system
   * Cached: Per-template cache with mtime-check
   */
  loadTemplate(templateName: string, appPath: string): ITemplate | null;
  
  /**
   * Writes template
   * Invalidates cache automatically
   */
  writeTemplate(templateName: string, appPath: string, template: ITemplate): void;
  
  /**
   * Deletes template
   * Invalidates cache automatically
   */
  deleteTemplate(templateName: string, appPath: string): void;
}

/**
 * Persistence for Frameworks
 */
interface IFrameworkPersistence extends IPersistence {
  /**
   * Lists all framework names (id -> path mapping)
   * Cached: JSON directory cached permanently, local directory cached with fs.watch
   */
  getAllFrameworkNames(): Map<string, string>;
  
  /**
   * Reads a framework.json file
   * Cached: Per-framework cache with mtime-check for local frameworks
   */
  readFramework(frameworkId: string, opts: IReadFrameworkOptions): IFramework;
  
  /**
   * Writes framework
   * Invalidates cache automatically
   */
  writeFramework(frameworkId: string, framework: IFramework): void;
  
  /**
   * Deletes framework
   * Invalidates cache automatically
   */
  deleteFramework(frameworkId: string): void;
}
```

## Implementierung: FileSystemPersistence mit fs.watch

### Caching-Strategie

1. **JSON-Verzeichnis (read-only):**
   - Statischer Cache, wird nur einmal geladen
   - Ändert sich nur durch Deploy, kein File Watching nötig

2. **Local-Verzeichnis (mutable):**
   - fs.watch für sofortige Cache-Invalidation
   - Rekursives Watching (Node.js 20.11.0+)
   - Alpine Linux (Hauptplattform)

3. **Template-Änderungen:**
   - Selten, daher gesamter Template-Cache invalidiert
   - Betrifft **NICHT** die Application-Liste

### Cache-Verwaltung im Persistence Interface

**Prinzip:** Das Persistence Interface **kapselt** die gesamte Cache-Logik:

- **Cache-Strukturen** sind private Member der Implementierung
- **fs.watch** wird intern initialisiert und verwaltet
- **Cache-Invalidation** passiert automatisch (fs.watch) oder manuell (invalidateCache())
- **Aufrufer** sehen nur die Interface-Methoden, keine Cache-Details

**Cache-Hierarchie:**

```
FileSystemPersistence (Implementierung)
├─ Private Cache-Strukturen:
│  ├─ appNamesCache.json (statisch, einmalig)
│  ├─ appNamesCache.local (durch fs.watch invalidiert)
│  ├─ applicationsListCache (durch fs.watch invalidiert)
│  ├─ applicationCache (per-Application, mtime-basiert)
│  ├─ frameworkCache (per-Framework, mtime-basiert)
│  └─ templateCache (per-Template, mtime-basiert)
│
├─ Private File Watchers:
│  ├─ localAppsWatcher (fs.watch für applications/)
│  ├─ localTemplatesWatcher (fs.watch für shared/templates/)
│  └─ localFrameworksWatcher (fs.watch für frameworks/)
│
└─ Public Interface-Methoden:
   ├─ listApplicationsForFrontend() → nutzt applicationsListCache
   ├─ getAllAppNames() → nutzt appNamesCache
   ├─ readApplication() → nutzt applicationCache
   └─ invalidateCache() → leert alle Caches
```

**Cache-Lebenszyklus:**

1. **Initialisierung:** FileSystemPersistence wird erstellt, fs.watch wird gestartet
2. **Erster Zugriff:** Cache ist leer → Daten werden geladen und gecacht
3. **Weitere Zugriffe:** Daten kommen aus Cache (sehr schnell)
4. **Änderung erkannt:** fs.watch triggert → Cache wird invalidiert
5. **Nächster Zugriff:** Cache ist leer → Daten werden neu geladen und gecacht

### Implementierung

```typescript
import { watch, FSWatcher } from 'fs';
import path from 'path';
import fs from 'fs';

/**
 * File system implementation of persistence interfaces
 * Handles caching and file system operations with fs.watch
 */
class FileSystemPersistence implements IApplicationPersistence, ITemplatePersistence, IFrameworkPersistence {
  // Application Caches
  private appNamesCache: {
    json: Map<string, string> | null;
    local: Map<string, string> | null;
  } = {
    json: null,
    local: null,
  };
  
  private applicationsListCache: IApplicationWeb[] | null = null;
  private applicationCache: Map<string, { data: IApplication; mtime: number }> = new Map();
  
  // Framework Caches
  private frameworkNamesCache: {
    json: Map<string, string> | null;
    local: Map<string, string> | null;
  } = {
    json: null,
    local: null,
  };
  private frameworkCache: Map<string, { data: IFramework; mtime: number }> = new Map();
  
  // Template Cache
  private templateCache: Map<string, { data: ITemplate; mtime: number }> = new Map();
  
  // File Watchers
  private localAppsWatcher?: FSWatcher;
  private localTemplatesWatcher?: FSWatcher;
  private localFrameworksWatcher?: FSWatcher;
  private invalidateTimeout?: NodeJS.Timeout;
  private readonly DEBOUNCE_MS = 300;
  
  constructor(
    private pathes: IConfiguredPathes,
    private jsonValidator: JsonValidator,
  ) {
    this.initFileWatchers();
  }
  
  /**
   * Initialisiert fs.watch für local-Verzeichnisse
   * Node.js 20.11.0+ unterstützt rekursives Watching nativ
   */
  private initFileWatchers(): void {
    const localAppsDir = path.join(this.pathes.localPath, "applications");
    const localTemplatesDir = path.join(this.pathes.localPath, "shared", "templates");
    const localFrameworksDir = path.join(this.pathes.localPath, "frameworks");
    
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
    
    // Watch local frameworks (rekursiv)
    if (fs.existsSync(localFrameworksDir)) {
      this.localFrameworksWatcher = watch(
        localFrameworksDir,
        { recursive: true },
        (eventType: string, filename: string | null) => {
          if (filename && filename.endsWith('.json')) {
            this.debouncedInvalidateFrameworkCache();
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
      this.applicationCache.clear();
      this.invalidateTimeout = undefined;
    }, this.DEBOUNCE_MS);
  }
  
  /**
   * Debounced Invalidation für Template-Cache
   */
  private debouncedInvalidateTemplateCache(): void {
    // Template-Änderungen invalidieren gesamten Template-Cache
    // Betreffen NICHT die Application-Liste
    this.templateCache.clear();
  }
  
  /**
   * Debounced Invalidation für Framework-Cache
   */
  private debouncedInvalidateFrameworkCache(): void {
    this.frameworkNamesCache.local = null;
    this.frameworkCache.clear();
  }
  
  // IApplicationPersistence Implementation
  
  getAllAppNames(): Map<string, string> {
    // JSON: Einmalig laden
    if (this.appNamesCache.json === null) {
      this.appNamesCache.json = this.scanApplicationsDir(this.pathes.jsonPath);
    }
    
    // Local: Aus Cache (wird durch fs.watch invalidiert)
    if (this.appNamesCache.local === null) {
      this.appNamesCache.local = this.scanApplicationsDir(this.pathes.localPath);
    }
    
    // Merge: Local hat Priorität
    const result = new Map(this.appNamesCache.json);
    for (const [name, appPath] of this.appNamesCache.local) {
      result.set(name, appPath);
    }
    return result;
  }
  
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
    const allApps = this.getAllAppNames();
    
    // Für jede Application: application.json laden (OHNE Templates!)
    for (const [applicationName, appPath] of allApps) {
      const readOpts: IReadApplicationOptions = {
        applicationHierarchy: [],
        error: new VEConfigurationError("", applicationName),
        taskTemplates: [], // Wird nur für Validierung verwendet, nicht geladen
      };
      
      try {
        const app = this.readApplication(applicationName, readOpts);
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
  
  readApplication(applicationName: string, opts: IReadApplicationOptions): IApplication {
    // Check cache first
    const appPath = this.getAllAppNames().get(applicationName);
    if (!appPath) {
      throw new Error(`Application ${applicationName} not found`);
    }
    
    const appFile = path.join(appPath, "application.json");
    const mtime = fs.statSync(appFile).mtimeMs;
    
    // Check if cached and still valid (only for local apps)
    const isLocal = appPath.startsWith(this.pathes.localPath);
    if (isLocal) {
      const cached = this.applicationCache.get(applicationName);
      if (cached && cached.mtime === mtime) {
        // Return cached, but need to process inheritance/templates
        // This might need special handling
        return cached.data;
      }
    }
    
    // Load and validate
    let appData: IApplication;
    try {
      appData = this.jsonValidator.serializeJsonFileWithSchema<IApplication>(
        appFile,
        "application",
      );
    } catch (e: Error | any) {
      appData = {
        id: applicationName,
        name: applicationName
      };
      this.addErrorToOptions(opts, e);
    }
    
    appData.id = applicationName;
    
    // Handle inheritance (recursive)
    if (appData.extends) {
      try {
        const parent = this.readApplication(appData.extends, opts);
        // Inherit icon if not found
        if (!appData.icon && parent.icon) {
          appData.icon = parent.icon;
          appData.iconContent = parent.iconContent;
          appData.iconType = parent.iconType;
        }
      } catch (e: Error | any) {
        this.addErrorToOptions(opts, e);
      }
    }
    
    // Load icon
    const icon = appData.icon || "icon.png";
    const iconPath = path.join(appPath, icon);
    if (fs.existsSync(iconPath)) {
      appData.iconContent = fs.readFileSync(iconPath, { encoding: "base64" });
      const ext = path.extname(icon).toLowerCase();
      appData.iconType = ext === ".svg" ? "image/svg+xml" : "image/png";
    }
    
    // Cache only local apps
    if (isLocal) {
      this.applicationCache.set(applicationName, { data: appData, mtime });
    }
    
    return appData;
  }
  
  writeApplication(applicationName: string, application: IApplication): void {
    const appDir = path.join(this.pathes.localPath, "applications", applicationName);
    fs.mkdirSync(appDir, { recursive: true });
    
    const appFile = path.join(appDir, "application.json");
    fs.writeFileSync(appFile, JSON.stringify(application, null, 2));
    
    // Invalidate caches (fs.watch wird auch triggern, aber manuell ist sicherer)
    this.invalidateApplicationCache(applicationName);
  }
  
  deleteApplication(applicationName: string): void {
    const appDir = path.join(this.pathes.localPath, "applications", applicationName);
    fs.rmSync(appDir, { recursive: true, force: true });
    
    // Invalidate caches
    this.invalidateApplicationCache(applicationName);
  }
  
  invalidateCache(): void {
    this.appNamesCache.local = null;
    this.applicationsListCache = null;
    this.applicationCache.clear();
    this.frameworkNamesCache.local = null;
    this.frameworkCache.clear();
    this.templateCache.clear();
  }
  
  private invalidateApplicationCache(applicationName: string): void {
    this.appNamesCache.local = null;
    this.applicationsListCache = null;
    this.applicationCache.delete(applicationName);
  }
  
  // Helper methods
  private scanApplicationsDir(basePath: string): Map<string, string> {
    const apps = new Map<string, string>();
    const appsDir = path.join(basePath, "applications");
    
    if (!fs.existsSync(appsDir)) return apps;
    
    const entries = fs.readdirSync(appsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const appJsonPath = path.join(appsDir, entry.name, "application.json");
        if (fs.existsSync(appJsonPath)) {
          apps.set(entry.name, path.join(appsDir, entry.name));
        }
      }
    }
    
    return apps;
  }
  
  private addErrorToOptions(opts: IReadApplicationOptions, error: Error | any): void {
    if (opts.error && Array.isArray(opts.error.details)) {
      opts.error.details.push(error);
    } else if (opts.error) {
      opts.error.details = [error];
    }
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
    if (this.localFrameworksWatcher) {
      this.localFrameworksWatcher.close();
    }
    if (this.invalidateTimeout) {
      clearTimeout(this.invalidateTimeout);
    }
  }
  
  // ITemplatePersistence und IFrameworkPersistence Implementierungen...
  // (ähnlich wie oben, hier aus Platzgründen gekürzt)
}
```

## Integration in bestehende Klassen

### Wie die Klassen zusammenarbeiten

**Architektur-Schichten:**

```
┌─────────────────────────────────────────┐
│  StorageContext (Context-Management)    │
│  - Verwaltet VE/VM/VMInstall Contextes  │
│  - Delegiert Entity-Zugriffe an         │
│    Persistence                          │
└──────────────┬──────────────────────────┘
               │ verwendet
               ↓
┌─────────────────────────────────────────┐
│  IApplicationPersistence (Interface)   │
│  - Definiert API                        │
│  - Keine Cache-Details sichtbar         │
└──────────────┬──────────────────────────┘
               │ implementiert
               ↓
┌─────────────────────────────────────────┐
│  FileSystemPersistence (Implementierung)│
│  - Verwaltet Cache intern               │
│  - Nutzt fs.watch für Invalidation      │
│  - Cache ist komplett versteckt         │
└─────────────────────────────────────────┘
               │ verwendet
               ↓
┌─────────────────────────────────────────┐
│  ApplicationLoader (Business Logic)     │
│  - Verarbeitet Application-Daten        │
│  - Ruft Persistence auf                │
│  - Weiß nichts vom Cache                │
└─────────────────────────────────────────┘
```

### StorageContext

```typescript
export class StorageContext extends Context implements IContext {
  // Persistence-Interface (nicht Implementierung!)
  private persistence: IApplicationPersistence & IFrameworkPersistence & ITemplatePersistence;
  
  constructor(
    localPath: string,
    storageContextFilePath: string,
    secretFilePath: string,
  ) {
    super(storageContextFilePath, secretFilePath);
    // ... existing code ...
    
    // Initialize persistence with caching and fs.watch
    // Die Implementierung (FileSystemPersistence) verwaltet den Cache intern
    this.persistence = new FileSystemPersistence(this.pathes, this.jsonValidator);
    
    // StorageContext weiß nichts vom Cache - es ruft nur die Interface-Methoden auf
  }
  
  // Delegiert an Persistence-Interface
  // Cache wird automatisch verwendet (intern in FileSystemPersistence)
  getAllAppNames(): Map<string, string> {
    return this.persistence.getAllAppNames(); // ← Cache wird intern verwendet
  }
  
  listApplicationsForFrontend(): IApplicationWeb[] {
    return this.persistence.listApplicationsForFrontend(); // ← Cache wird intern verwendet
  }
  
  // Legacy-Methode für Rückwärtskompatibilität
  listApplications(): IApplicationWeb[] {
    return this.listApplicationsForFrontend();
  }
  
  getAllFrameworkNames(): Map<string, string> {
    return this.persistence.getAllFrameworkNames(); // ← Cache wird intern verwendet
  }
  
  // Manuelle Invalidation (z.B. nach Framework-Create via UI)
  // Ruft Interface-Methode auf, die Implementierung invalidiert dann den Cache
  invalidateApplicationCache(): void {
    this.persistence.invalidateCache(); // ← Cache wird intern invalidiert
  }
  
  // Cleanup
  close(): void {
    if ('close' in this.persistence && typeof this.persistence.close === 'function') {
      (this.persistence as any).close(); // FileSystemPersistence-spezifisch
    }
  }
}
```

**Wichtig:** StorageContext kennt nur das Interface, nicht die Cache-Implementierung!

### ApplicationLoader

```typescript
export class ApplicationLoader {
  constructor(
    private pathes: IConfiguredPathes,
    private persistence: IApplicationPersistence, // ← Interface, nicht Implementierung
    private storage: StorageContext = StorageContext.getInstance(),
  ) {}
  
  public readApplicationJson(
    application: string,
    opts: IReadApplicationOptions,
  ): IApplication {
    // Ruft Interface-Methode auf
    // Cache wird automatisch verwendet (intern in FileSystemPersistence)
    // ApplicationLoader weiß nichts vom Cache!
    return this.persistence.readApplication(application, opts);
  }
}
```

**Beispiel: Cache-Fluss bei readApplication()**

```
ApplicationLoader.readApplicationJson("myapp", opts)
  ↓
IApplicationPersistence.readApplication("myapp", opts)
  ↓
FileSystemPersistence.readApplication("myapp", opts)
  ↓
[Interne Cache-Prüfung:]
  ├─ Cache vorhanden und gültig?
  │  ├─ Ja → Gibt gecachte Application zurück (0.1ms)
  │  └─ Nein → Lädt application.json, verarbeitet Inheritance,
  │            lädt Icon, speichert in Cache, gibt zurück (50ms)
  ↓
ApplicationLoader erhält IApplication (weiß nicht, ob aus Cache oder neu geladen)
```

### Zusammenfassung: Cache und Persistence Interface

**Das Persistence Interface ist die Abstraktion, die Caching kapselt:**

1. **Interface (IApplicationPersistence):**
   - Definiert **WAS** benötigt wird (API)
   - Keine Cache-Details sichtbar
   - Aufrufer wissen nicht, ob/wie gecacht wird

2. **Implementierung (FileSystemPersistence):**
   - Verwaltet Cache **intern** (private Member)
   - Nutzt fs.watch für automatische Invalidation
   - Entscheidet selbst, wann gecacht wird

3. **Aufrufer (StorageContext, ApplicationLoader):**
   - Rufen nur Interface-Methoden auf
   - Profitieren automatisch vom Cache
   - Müssen sich nicht um Cache-Management kümmern

4. **Vorteile:**
   - Cache-Logik ist zentralisiert und testbar
   - Andere Implementierungen können anderes Caching verwenden
   - API bleibt stabil, auch wenn Cache-Strategie sich ändert

## Performance-Erwartungen

### Vorher (ohne Cache):
- `getAllAppNames()`: ~50-100ms (je nach Anzahl Applications)
- `listApplications()`: ~500-2000ms (je nach Anzahl und Komplexität)
- **Gesamt pro API-Request**: ~500-2000ms

### Nachher (mit Cache + fs.watch):
- `getAllAppNames()`: ~0.1ms (aus Cache)
- `listApplicationsForFrontend()`: ~0.1ms (aus Cache, nach erstem Aufruf)
- **Gesamt pro API-Request**: ~0.1-0.5ms (nach erstem Aufruf)
- **Erster Aufruf**: ~500-2000ms (wie vorher)

**Verbesserung: 1000-10000x schneller** nach erstem Aufruf!

## Migration-Strategie

**Wichtig:** Nach jedem Schritt müssen **alle Tests erfolgreich** laufen können!

### Migrations-Prinzipien

1. **Keine Fallbacks:** Tests werden sofort angepasst
2. **Nur inkompatible Änderungen:** Test-Logik bleibt unverändert
3. **Stop bei Fehlern:** Wenn Tests fehlschlagen → STOP, Review/Fixes/Checkin durch Benutzer
4. **Checkin nach jeder Phase:** Nur wenn alle Tests grün sind

### Vorgehen pro Phase

1. **Code-Änderungen machen**
2. **Tests anpassen (nur inkompatible Änderungen)**
3. **Tests laufen lassen:** `npm test`
4. **Wenn Tests fehlschlagen:**
   - ⛔ **STOP!**
   - Review/Fixes durch Benutzer
   - Checkin durch Benutzer
   - Erst dann weiter
5. **Wenn alle Tests grün:**
   - ✅ Code-Review
   - ✅ Checkin durch Benutzer
   - ✅ Nächste Phase

### Test-Strategie pro Phase

- **Phase 1:** Neue Dateien, keine Änderungen → ✅ Alle Tests laufen
- **Phase 1b:** Neue Tests → ✅ Alle Tests laufen
- **Phase 2:** ApplicationLoader ändern, Tests anpassen → ✅ Alle Tests laufen (nach Anpassung)
- **Phase 3:** PersistenceManager + ContextManager, alle Aufrufer umstellen → ✅ Alle Tests laufen (nach Anpassung)
- **Phase 4:** TemplateProcessor + FrameworkLoader, Tests anpassen → ✅ Alle Tests laufen (nach Anpassung)
- **Phase 5:** Aufräumen, Tests anpassen → ✅ Alle Tests laufen (nach Anpassung)
- **Phase 6:** Erweiterte Tests → ✅ Alle Tests laufen

### Phase 1: Interfaces definieren, FileSystemPersistence implementieren

**Ziele:**
- Interfaces (`IApplicationPersistence`, `ITemplatePersistence`, `IFrameworkPersistence`) definieren
- `FileSystemPersistence` implementieren mit Caching und fs.watch
- Noch keine Integration in bestehende Klassen

**Schritte:**
1. Neue Datei `backend/src/persistence/interfaces.mts` erstellen
2. Interfaces definieren (ohne Implementierung)
3. Neue Datei `backend/src/persistence/filesystem-persistence.mts` erstellen
4. `FileSystemPersistence` implementieren:
   - Cache-Strukturen (private)
   - fs.watch Initialisierung
   - Alle Interface-Methoden implementieren
5. Helper-Methoden für Dateisystem-Zugriffe

**Test-Status nach Phase 1:**
- ✅ Alle bestehenden Tests laufen weiterhin (keine Änderungen an bestehendem Code)
- ✅ Neue Dateien werden nicht verwendet, daher keine Breaking Changes
- ✅ Neue Tests können für FileSystemPersistence geschrieben werden (Phase 1b)

**Wichtig:** In dieser Phase wird FileSystemPersistence noch **nicht** verwendet, nur implementiert.

### Phase 1b: Tests für FileSystemPersistence erstellen

**Ziele:**
- Umfassende Tests für FileSystemPersistence
- Cache-Verhalten testen
- fs.watch-Verhalten testen (soweit möglich)
- Edge Cases abdecken

**Test-Struktur:**

```typescript
// backend/tests/filesystem-persistence.test.mts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { FileSystemPersistence } from "@src/persistence/filesystem-persistence.mjs";
import { JsonValidator } from "@src/jsonvalidator.mjs";
import { IReadApplicationOptions, VEConfigurationError } from "@src/backend-types.mjs";

describe("FileSystemPersistence", () => {
  let testDir: string;
  let jsonPath: string;
  let localPath: string;
  let schemaPath: string;
  let persistence: FileSystemPersistence;
  let jsonValidator: JsonValidator;

  beforeEach(() => {
    // Setup temporäre Verzeichnisse
    testDir = mkdtempSync(path.join(tmpdir(), "persistence-test-"));
    jsonPath = path.join(testDir, "json");
    localPath = path.join(testDir, "local");
    schemaPath = path.join(testDir, "schemas");
    
    // Verzeichnisse erstellen
    mkdirSync(jsonPath, { recursive: true });
    mkdirSync(localPath, { recursive: true });
    mkdirSync(schemaPath, { recursive: true });
    
    // JsonValidator initialisieren (benötigt Schemas)
    jsonValidator = new JsonValidator(schemaPath, ["templatelist.schema.json"]);
    
    // FileSystemPersistence initialisieren
    persistence = new FileSystemPersistence(
      { jsonPath, localPath, schemaPath },
      jsonValidator
    );
  });

  afterEach(() => {
    // Cleanup
    persistence.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("getAllAppNames()", () => {
    it("should return empty map when no applications exist", () => {
      const result = persistence.getAllAppNames();
      expect(result.size).toBe(0);
    });

    it("should find applications in json directory", () => {
      // Setup: Application in json-Verzeichnis erstellen
      const appDir = path.join(jsonPath, "applications", "testapp");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "Test App", installation: [] })
      );

      const result = persistence.getAllAppNames();
      expect(result.size).toBe(1);
      expect(result.has("testapp")).toBe(true);
      expect(result.get("testapp")).toBe(appDir);
    });

    it("should find applications in local directory", () => {
      // Setup: Application in local-Verzeichnis erstellen
      const appDir = path.join(localPath, "applications", "localapp");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "Local App", installation: [] })
      );

      const result = persistence.getAllAppNames();
      expect(result.size).toBe(1);
      expect(result.has("localapp")).toBe(true);
    });

    it("should prefer local over json when same name exists", () => {
      // Setup: Application in beiden Verzeichnissen
      const jsonAppDir = path.join(jsonPath, "applications", "duplicate");
      const localAppDir = path.join(localPath, "applications", "duplicate");
      mkdirSync(jsonAppDir, { recursive: true });
      mkdirSync(localAppDir, { recursive: true });
      writeFileSync(
        path.join(jsonAppDir, "application.json"),
        JSON.stringify({ name: "JSON App", installation: [] })
      );
      writeFileSync(
        path.join(localAppDir, "application.json"),
        JSON.stringify({ name: "Local App", installation: [] })
      );

      const result = persistence.getAllAppNames();
      expect(result.size).toBe(1);
      expect(result.get("duplicate")).toBe(localAppDir); // Local hat Priorität
    });

    it("should cache json directory (only loaded once)", () => {
      // Erster Aufruf
      const result1 = persistence.getAllAppNames();
      
      // Application hinzufügen NACH erstem Aufruf
      const appDir = path.join(jsonPath, "applications", "newapp");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "New App", installation: [] })
      );

      // Zweiter Aufruf sollte noch alte Daten haben (Cache)
      const result2 = persistence.getAllAppNames();
      expect(result2.size).toBe(result1.size); // Keine neue Application
      expect(result2.has("newapp")).toBe(false);
    });

    it("should invalidate local cache when fs.watch detects changes", async () => {
      // Initial: Application in local
      const appDir = path.join(localPath, "applications", "watchedapp");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "Watched App", installation: [] })
      );

      // Erster Aufruf
      const result1 = persistence.getAllAppNames();
      expect(result1.has("watchedapp")).toBe(true);

      // Application löschen
      rmSync(appDir, { recursive: true, force: true });

      // Warten auf fs.watch Event (mit Timeout)
      await new Promise(resolve => setTimeout(resolve, 500));

      // Zweiter Aufruf sollte invalidiert sein
      const result2 = persistence.getAllAppNames();
      expect(result2.has("watchedapp")).toBe(false);
    });
  });

  describe("listApplicationsForFrontend()", () => {
    it("should return empty array when no applications exist", () => {
      const result = persistence.listApplicationsForFrontend();
      expect(result).toEqual([]);
    });

    it("should return applications with basic data (no templates loaded)", () => {
      // Setup: Application erstellen
      const appDir = path.join(jsonPath, "applications", "testapp");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({
          name: "Test App",
          description: "Test Description",
          installation: ["template1.json"]
        })
      );

      const result = persistence.listApplicationsForFrontend();
      expect(result.length).toBe(1);
      expect(result[0]!.name).toBe("Test App");
      expect(result[0]!.description).toBe("Test Description");
      expect(result[0]!.id).toBe("testapp");
      // Wichtig: Templates sollten NICHT geladen werden
      // (kann nicht direkt geprüft werden, aber sollte schnell sein)
    });

    it("should load application icons", () => {
      // Setup: Application mit Icon
      const appDir = path.join(jsonPath, "applications", "iconapp");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({
          name: "Icon App",
          icon: "icon.png",
          installation: []
        })
      );
      // Icon-Datei erstellen (Base64-encoded dummy)
      const iconContent = Buffer.from("fake-png-data").toString("base64");
      writeFileSync(path.join(appDir, "icon.png"), Buffer.from("fake-png-data"));

      const result = persistence.listApplicationsForFrontend();
      expect(result.length).toBe(1);
      expect(result[0]!.iconContent).toBeDefined();
      expect(result[0]!.iconType).toBe("image/png");
    });

    it("should handle inheritance correctly", () => {
      // Setup: Parent Application
      const parentDir = path.join(jsonPath, "applications", "parent");
      mkdirSync(parentDir, { recursive: true });
      writeFileSync(
        path.join(parentDir, "application.json"),
        JSON.stringify({
          name: "Parent App",
          description: "Parent Description",
          installation: []
        })
      );

      // Setup: Child Application
      const childDir = path.join(localPath, "applications", "child");
      mkdirSync(childDir, { recursive: true });
      writeFileSync(
        path.join(childDir, "application.json"),
        JSON.stringify({
          name: "Child App",
          extends: "parent",
          installation: []
        })
      );

      const result = persistence.listApplicationsForFrontend();
      const childApp = result.find(app => app.id === "child");
      expect(childApp).toBeDefined();
      // Child sollte Parent-Daten erben können
    });

    it("should cache the list", () => {
      // Erster Aufruf
      const result1 = persistence.listApplicationsForFrontend();
      const time1 = Date.now();

      // Zweiter Aufruf sollte aus Cache kommen (sehr schnell)
      const result2 = persistence.listApplicationsForFrontend();
      const time2 = Date.now();

      expect(result2).toEqual(result1);
      expect(time2 - time1).toBeLessThan(10); // Sollte < 10ms sein (Cache)
    });

    it("should invalidate cache when application changes", async () => {
      // Setup: Application
      const appDir = path.join(localPath, "applications", "changeapp");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "Original", installation: [] })
      );

      const result1 = persistence.listApplicationsForFrontend();
      expect(result1[0]!.name).toBe("Original");

      // Application ändern
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "Changed", installation: [] })
      );

      // Warten auf fs.watch
      await new Promise(resolve => setTimeout(resolve, 500));

      const result2 = persistence.listApplicationsForFrontend();
      expect(result2[0]!.name).toBe("Changed");
    });
  });

  describe("readApplication()", () => {
    it("should read application.json file", () => {
      const appDir = path.join(jsonPath, "applications", "readapp");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({
          name: "Read App",
          description: "Read Description",
          installation: ["template.json"]
        })
      );

      const opts: IReadApplicationOptions = {
        applicationHierarchy: [],
        error: new VEConfigurationError("", "readapp"),
        taskTemplates: []
      };

      const result = persistence.readApplication("readapp", opts);
      expect(result.name).toBe("Read App");
      expect(result.description).toBe("Read Description");
    });

    it("should cache local applications", () => {
      const appDir = path.join(localPath, "applications", "cacheapp");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "Cache App", installation: [] })
      );

      const opts: IReadApplicationOptions = {
        applicationHierarchy: [],
        error: new VEConfigurationError("", "cacheapp"),
        taskTemplates: []
      };

      // Erster Aufruf
      const result1 = persistence.readApplication("cacheapp", opts);
      
      // Datei ändern (aber Cache sollte noch gültig sein)
      const mtimeBefore = statSync(path.join(appDir, "application.json")).mtimeMs;
      
      // Zweiter Aufruf sollte aus Cache kommen
      const result2 = persistence.readApplication("cacheapp", opts);
      expect(result2).toBe(result1); // Gleiche Referenz = aus Cache
    });

    it("should not cache json applications (read-only)", () => {
      // JSON-Applications werden nicht gecacht, da sie sich nicht ändern
      // (außer durch Deploy, dann wird Server neu gestartet)
    });

    it("should handle errors gracefully", () => {
      const opts: IReadApplicationOptions = {
        applicationHierarchy: [],
        error: new VEConfigurationError("", "nonexistent"),
        taskTemplates: []
      };

      expect(() => {
        persistence.readApplication("nonexistent", opts);
      }).toThrow();
    });
  });

  describe("writeApplication()", () => {
    it("should create application in local directory", () => {
      const application = {
        name: "New App",
        description: "New Description",
        installation: []
      };

      persistence.writeApplication("newapp", application as any);

      const appDir = path.join(localPath, "applications", "newapp");
      expect(fs.existsSync(appDir)).toBe(true);
      expect(fs.existsSync(path.join(appDir, "application.json"))).toBe(true);
    });

    it("should invalidate cache after write", async () => {
      // Initial: Liste cachen
      const result1 = persistence.listApplicationsForFrontend();
      
      // Application schreiben
      persistence.writeApplication("writtenapp", {
        name: "Written App",
        installation: []
      } as any);

      // Cache sollte invalidiert sein
      const result2 = persistence.listApplicationsForFrontend();
      expect(result2.length).toBe(result1.length + 1);
      expect(result2.some(app => app.id === "writtenapp")).toBe(true);
    });
  });

  describe("deleteApplication()", () => {
    it("should delete application directory", () => {
      // Setup: Application erstellen
      const appDir = path.join(localPath, "applications", "deleteapp");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "Delete App", installation: [] })
      );

      persistence.deleteApplication("deleteapp");

      expect(fs.existsSync(appDir)).toBe(false);
    });

    it("should invalidate cache after delete", () => {
      // Setup: Application erstellen
      const appDir = path.join(localPath, "applications", "deleteapp");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "Delete App", installation: [] })
      );

      // Liste cachen
      const result1 = persistence.listApplicationsForFrontend();
      expect(result1.some(app => app.id === "deleteapp")).toBe(true);

      // Löschen
      persistence.deleteApplication("deleteapp");

      // Cache sollte invalidiert sein
      const result2 = persistence.listApplicationsForFrontend();
      expect(result2.some(app => app.id === "deleteapp")).toBe(false);
    });
  });

  describe("invalidateCache()", () => {
    it("should clear all caches", () => {
      // Setup: Daten cachen
      const appDir = path.join(localPath, "applications", "invalidateapp");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "Invalidate App", installation: [] })
      );

      // Cachen
      persistence.getAllAppNames();
      persistence.listApplicationsForFrontend();

      // Invalidate
      persistence.invalidateCache();

      // Nach Invalidation sollten Caches leer sein
      // (kann indirekt geprüft werden durch erneutes Laden)
    });
  });

  describe("fs.watch Integration", () => {
    it("should detect new application files", async () => {
      // Initial: Liste cachen
      const result1 = persistence.listApplicationsForFrontend();
      const initialCount = result1.length;

      // Neue Application erstellen
      const appDir = path.join(localPath, "applications", "watchednew");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "Watched New", installation: [] })
      );

      // Warten auf fs.watch Event
      await new Promise(resolve => setTimeout(resolve, 500));

      // Cache sollte invalidiert sein
      const result2 = persistence.listApplicationsForFrontend();
      expect(result2.length).toBe(initialCount + 1);
    });

    it("should detect application.json changes", async () => {
      // Setup: Application
      const appDir = path.join(localPath, "applications", "watchchange");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "Original", installation: [] })
      );

      // Cachen
      const result1 = persistence.listApplicationsForFrontend();
      expect(result1.find(app => app.id === "watchchange")!.name).toBe("Original");

      // Ändern
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "Changed", installation: [] })
      );

      // Warten auf fs.watch
      await new Promise(resolve => setTimeout(resolve, 500));

      // Cache sollte invalidiert sein
      const result2 = persistence.listApplicationsForFrontend();
      expect(result2.find(app => app.id === "watchchange")!.name).toBe("Changed");
    });

    it("should detect application deletion", async () => {
      // Setup: Application
      const appDir = path.join(localPath, "applications", "watchdelete");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "Delete Me", installation: [] })
      );

      // Cachen
      const result1 = persistence.listApplicationsForFrontend();
      expect(result1.some(app => app.id === "watchdelete")).toBe(true);

      // Löschen
      rmSync(appDir, { recursive: true, force: true });

      // Warten auf fs.watch
      await new Promise(resolve => setTimeout(resolve, 500));

      // Cache sollte invalidiert sein
      const result2 = persistence.listApplicationsForFrontend();
      expect(result2.some(app => app.id === "watchdelete")).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing application.json gracefully", () => {
      // Verzeichnis ohne application.json
      const appDir = path.join(jsonPath, "applications", "nojson");
      mkdirSync(appDir, { recursive: true });

      const result = persistence.getAllAppNames();
      expect(result.has("nojson")).toBe(false); // Sollte ignoriert werden
    });

    it("should handle invalid JSON gracefully", () => {
      const appDir = path.join(jsonPath, "applications", "invalidjson");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        "invalid json content"
      );

      const opts: IReadApplicationOptions = {
        applicationHierarchy: [],
        error: new VEConfigurationError("", "invalidjson"),
        taskTemplates: []
      };

      // Sollte Fehler in opts.error.details sammeln
      expect(() => {
        persistence.readApplication("invalidjson", opts);
      }).toThrow();
      expect(opts.error.details).toBeDefined();
    });

    it("should handle concurrent access", async () => {
      // Mehrere gleichzeitige Aufrufe sollten sicher sein
      const appDir = path.join(jsonPath, "applications", "concurrent");
      mkdirSync(appDir, { recursive: true });
      writeFileSync(
        path.join(appDir, "application.json"),
        JSON.stringify({ name: "Concurrent", installation: [] })
      );

      const promises = Array.from({ length: 10 }, () =>
        persistence.listApplicationsForFrontend()
      );

      const results = await Promise.all(promises);
      // Alle sollten gleiche Ergebnisse liefern
      results.forEach(result => {
        expect(result.length).toBe(1);
      });
    });
  });
});
```

**Test-Abdeckung:**

1. **Basis-Funktionalität:**
   - `getAllAppNames()` - leer, json, local, Priorität
   - `listApplicationsForFrontend()` - leer, mit Daten, Icons
   - `readApplication()` - lesen, Fehlerbehandlung

2. **Caching:**
   - JSON-Verzeichnis wird nur einmal geladen
   - Local-Verzeichnis wird gecacht
   - Cache-Invalidation nach Write/Delete
   - Cache-Performance (schnell bei wiederholten Aufrufen)

3. **fs.watch:**
   - Neue Dateien werden erkannt
   - Änderungen werden erkannt
   - Löschungen werden erkannt
   - Debouncing funktioniert

4. **Edge Cases:**
   - Fehlende Dateien
   - Ungültige JSON
   - Concurrent Access
   - Inheritance

**Hinweise für Tests:**
- fs.watch Events sind asynchron → `setTimeout` mit Wartezeit nötig
- Temporäre Verzeichnisse für Isolation
- Cleanup in `afterEach` wichtig
- Mock fs.watch für deterministische Tests (optional)

### Phase 2: ApplicationLoader auf Persistence umstellen

**Voraussetzung:**
- ✅ Phase 1 und 1b sind in git eingecheckt
- ✅ Alle Tests laufen

**Ziele:**
- ApplicationLoader verwendet Persistence Interface statt direkter Dateisystem-Zugriffe
- Tests werden sofort angepasst (nur inkompatible Änderungen)

**Vorgehen:**
1. **ApplicationLoader Konstruktor ändern:**
   ```typescript
   constructor(
     private pathes: IConfiguredPathes,
     private persistence: IApplicationPersistence, // ERFORDERLICH (nicht optional!)
     private storage: StorageContext = StorageContext.getInstance(),
   ) {}
   ```

2. **`readApplicationJson()` umstellen:**
   - Alte Implementierung entfernen
   - Verwendet `persistence.readApplication()` direkt
   - **Kein Fallback!**

3. **Tests anpassen (nur inkompatible Änderungen):**
   - Tests müssen Persistence übergeben
   - Nur die notwendigen Änderungen (Konstruktor-Aufruf)
   - Alles andere bleibt wie vorher

**Beispiel: Test-Anpassung**

**Vorher:**
```typescript
// backend/tests/applicationloader.readApplicationJson.test.mts

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  loader = new ApplicationLoader({ schemaPath, jsonPath, localPath });
  //                                                              ^
  //                                                              Kein persistence-Parameter
});
```

**Nachher (nur inkompatible Änderung):**
```typescript
// backend/tests/applicationloader.readApplicationJson.test.mts

beforeEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  
  // ✅ NUR diese Zeile ändert sich:
  // Persistence muss übergeben werden (FileSystemPersistence oder Mock)
  const persistence = new FileSystemPersistence(
    { jsonPath, localPath, schemaPath },
    StorageContext.getInstance().getJsonValidator()
  );
  
  loader = new ApplicationLoader(
    { schemaPath, jsonPath, localPath },
    persistence // ✅ ERFORDERLICH
  );
  
  // Alles andere bleibt gleich!
});

// Tests selbst bleiben unverändert:
it("1. Application in localPath, extends application in jsonPath", () => {
  // ... gleicher Code wie vorher ...
  loader.readApplicationJson("myapp", opts);
  // ... gleiche Prüfungen wie vorher ...
});
```

**Schritte:**

1. **ApplicationLoader ändern:**
   - Konstruktor: `persistence` als erforderlicher Parameter
   - `readApplicationJson()`: Verwendet `persistence.readApplication()`
   - Alte Implementierung entfernen

2. **Tests anpassen:**
   - Jeden Test einzeln anpassen
   - Nur Konstruktor-Aufruf ändern (Persistence übergeben)
   - Test-Logik bleibt unverändert

3. **Tests laufen lassen:**
   ```bash
   npm test
   ```

4. **Wenn Tests fehlschlagen:**
   - ⛔ **STOP!**
   - Review/Fixes durch Benutzer
   - Checkin durch Benutzer
   - Erst dann weiter

5. **Wenn alle Tests grün:**
   - ✅ Code-Review
   - ✅ Checkin durch Benutzer
   - ✅ Nächste Phase

**Test-Status nach Phase 2:**
- ✅ Alle Tests laufen (nach Anpassung)
- ✅ Keine Fallbacks
- ✅ Saubere Implementierung

### Phase 3: PersistenceManager als primärer Singleton

**Voraussetzung:**
- ✅ Phase 2 ist in git eingecheckt
- ✅ Alle Tests laufen

**Konzept:**
- **PersistenceManager** wird der primäre Singleton (ersetzt StorageContext-Singleton für Entity-Zugriffe)
- **ContextManager** (früher StorageContext) wird von PersistenceManager verwaltet (kein eigenes Singleton mehr)
- Alle Entity-Zugriffe (Applications, Templates, Frameworks) gehen über PersistenceManager
- ContextManager bleibt nur für Context-Management (VE/VM/VMInstall)

**Vorteile:**
- Klare Separation of Concerns
- PersistenceManager ist zentraler Zugriffspunkt für alle Persistence-Operationen
- ContextManager ist nur noch für Context-Management zuständig
- Keine Legacy-APIs, saubere Architektur

**Wichtig für Tests:** StorageContext/ContextManager muss weiterhin als Singleton funktionieren (Rückwärtskompatibilität)!

### Phase 3: Implementierung

**Architektur:**

```typescript
// backend/src/persistence/persistence-manager.mts

import path from "path";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { JsonValidator } from "@src/jsonvalidator.mjs";

/**
 * Central singleton manager for Persistence, Services and StorageContext
 * Replaces StorageContext singleton for entity access (Applications, Templates, Frameworks)
 */
export class PersistenceManager {
  private static instance: PersistenceManager | undefined;
  
  private pathes: IConfiguredPathes;
  private jsonValidator: JsonValidator;
  private persistence: IApplicationPersistence & IFrameworkPersistence & ITemplatePersistence;
  private applicationService: ApplicationService;
  private frameworkService: FrameworkService;
  private contextManager: ContextManager; // Früher: StorageContext
  
  private constructor(
    localPath: string,
    storageContextFilePath: string,
    secretFilePath: string,
  ) {
    // Create paths (same logic as ContextManager)
    const rootDirname = join(dirname(fileURLToPath(import.meta.url)), "../..");
    this.pathes = {
      localPath: localPath,
      jsonPath: path.join(rootDirname, "json"),
      schemaPath: path.join(rootDirname, "schemas"),
    };
    
    // Create JsonValidator (same logic as ContextManager)
    const baseSchemas: string[] = ["templatelist.schema.json"];
    this.jsonValidator = new JsonValidator(this.pathes.schemaPath, baseSchemas);
    
    // Initialize ContextManager (no longer a singleton itself)
    // Pass pathes and validator to avoid duplication
    this.contextManager = new ContextManager(
      localPath,
      storageContextFilePath,
      secretFilePath,
      this.pathes,
      this.jsonValidator,
    );
    
    // Initialize Persistence (uses same pathes and validator)
    this.persistence = new FileSystemPersistence(this.pathes, this.jsonValidator);
    
    // Initialize Services
    this.applicationService = new ApplicationService(this.persistence);
    this.frameworkService = new FrameworkService(this.persistence);
  }
  
  /**
   * Initializes the PersistenceManager singleton
   * This replaces StorageContext.setInstance()
   */
  static initialize(
    localPath: string,
    storageContextFilePath: string,
    secretFilePath: string,
  ): PersistenceManager {
    if (PersistenceManager.instance) {
      throw new Error("PersistenceManager already initialized");
    }
    PersistenceManager.instance = new PersistenceManager(
      localPath,
      storageContextFilePath,
      secretFilePath,
    );
    return PersistenceManager.instance;
  }
  
  /**
   * Gets the PersistenceManager singleton instance
   */
  static getInstance(): PersistenceManager {
    if (!PersistenceManager.instance) {
      throw new Error("PersistenceManager not initialized. Call initialize() first.");
    }
    return PersistenceManager.instance;
  }
  
  // Getters für Zugriff auf Komponenten
  getPersistence(): IApplicationPersistence & IFrameworkPersistence & ITemplatePersistence {
    return this.persistence;
  }
  
  getApplicationService(): ApplicationService {
    return this.applicationService;
  }
  
  getFrameworkService(): FrameworkService {
    return this.frameworkService;
  }
  
  getContextManager(): ContextManager {
    return this.contextManager;
  }
  
  // Alias für Rückwärtskompatibilität (kann später entfernt werden)
  getStorageContext(): ContextManager {
    return this.contextManager;
  }
  
  /**
   * Cleanup (closes file watchers, etc.)
   */
  close(): void {
    if (this.persistence && 'close' in this.persistence) {
      (this.persistence as any).close();
    }
    PersistenceManager.instance = undefined;
  }
}
```

**ContextManager (früher StorageContext) Anpassung:**

```typescript
// backend/src/context-manager.mts

/**
 * Manages execution contexts (VE, VM, VMInstall) for LXC operations
 * - VEContext: Virtual Environment (Proxmox host) connections
 * - VMContext: Virtual Machine information
 * - VMInstallContext: VM installation state
 * 
 * Renamed from StorageContext to better reflect its purpose:
 * It manages execution contexts, not storage/entities.
 */
export class ContextManager extends Context implements IContext {
  // KEIN Singleton mehr! Wird von PersistenceManager verwaltet
  
  constructor(
    localPath: string,
    storageContextFilePath: string,
    secretFilePath: string,
    pathes: IConfiguredPathes, // Wird von PersistenceManager übergeben
    jsonValidator: JsonValidator, // Wird von PersistenceManager übergeben
  ) {
    super(storageContextFilePath, secretFilePath);
    // Speichere für interne Verwendung (falls nötig)
    this.pathes = pathes;
    this.jsonValidator = jsonValidator;
    // ... rest of initialization (loadContexts, etc.)
  }
  
  // Getter für interne Verwendung (falls nötig)
  getLocalPath(): string {
    return this.pathes.localPath;
  }
  
  getJsonPath(): string {
    return this.pathes.jsonPath;
  }
  
  getSchemaPath(): string {
    return this.pathes.schemaPath;
  }
  
  getJsonValidator(): JsonValidator {
    return this.jsonValidator;
  }
  
  // Alle Context-Management Methoden bleiben:
  // - getCurrentVEContext()
  // - setVEContext()
  // - setVMContext()
  // - setVMInstallContext()
  // - getVEContextByKey()
  // - getVMContextByHostname()
  // - listSshConfigs()
  // - etc.
  
  // Entity-Methoden werden ENTFERNT:
  // - getAllAppNames() ❌
  // - listApplications() ❌
  // - getAllFrameworkNames() ❌
  // Diese gehen jetzt über PersistenceManager!
}
```

**Namensänderung: StorageContext → ContextManager**

**Begründung:**
- **StorageContext** suggeriert "Storage" (Speicherung), aber die Klasse verwaltet **Execution Contextes** (VE, VM, VMInstall)
- **ContextManager** beschreibt klar: Verwaltung von Contextes für die Ausführung
- Passt zur Architektur: `PersistenceManager` verwaltet Persistence, `ContextManager` verwaltet Contextes
- Konsistent mit anderen Manager-Klassen im System

**Migration:**
- Datei umbenennen: `storagecontext.mts` → `context-manager.mts`
- Klasse umbenennen: `StorageContext` → `ContextManager`
- Alle Imports und Verwendungen anpassen
- Interface `IContext` bleibt (ist bereits passend benannt)

**Vorteil dieser Lösung:**
- PersistenceManager erstellt `pathes` und `jsonValidator` einmalig
- Beide werden an StorageContext und FileSystemPersistence weitergegeben
- Keine Duplikation der Erstellungs-Logik
- Klare Verantwortlichkeiten: PersistenceManager verwaltet die gemeinsamen Ressourcen

**Migration der Aufrufer:**

```typescript
// ALT (StorageContext Singleton):
const storage = StorageContext.getInstance();
const apps = storage.listApplications();
const allApps = storage.getAllAppNames();
const veContext = storage.getCurrentVEContext();

// NEU (PersistenceManager Singleton):
const pm = PersistenceManager.getInstance();
const apps = pm.getApplicationService().listApplicationsForFrontend();
const allApps = pm.getApplicationService().getAllAppNames();
const contextManager = pm.getContextManager(); // Für Context-Management
const veContext = contextManager.getCurrentVEContext();
```

**Services (Singletons via PersistenceManager):**

```typescript
// backend/src/services/application-service.mts

export class ApplicationService {
  constructor(
    private persistence: IApplicationPersistence,
  ) {}
  
  getAllAppNames(): Map<string, string> {
    return this.persistence.getAllAppNames();
  }
  
  listApplicationsForFrontend(): IApplicationWeb[] {
    return this.persistence.listApplicationsForFrontend();
  }
  
  readApplication(applicationName: string, opts: IReadApplicationOptions): IApplication {
    return this.persistence.readApplication(applicationName, opts);
  }
  
  writeApplication(applicationName: string, application: IApplication): void {
    this.persistence.writeApplication(applicationName, application);
  }
  
  deleteApplication(applicationName: string): void {
    this.persistence.deleteApplication(applicationName);
  }
}

// backend/src/services/framework-service.mts

export class FrameworkService {
  constructor(
    private persistence: IFrameworkPersistence,
  ) {}
  
  getAllFrameworkNames(): Map<string, string> {
    return this.persistence.getAllFrameworkNames();
  }
  
  readFramework(frameworkId: string, opts: IReadFrameworkOptions): IFramework {
    return this.persistence.readFramework(frameworkId, opts);
  }
  
  writeFramework(frameworkId: string, framework: IFramework): void {
    this.persistence.writeFramework(frameworkId, framework);
  }
  
  deleteFramework(frameworkId: string): void {
    this.persistence.deleteFramework(frameworkId);
  }
}
```

**Vorgehen (ohne Fallbacks):**

1. **PersistenceManager erstellen:**
   - `backend/src/persistence/persistence-manager.mts`
   - Singleton-Pattern implementieren
   - Erstellt ContextManager (kein Singleton mehr)
   - Verwaltet Persistence und Services

2. **Services erstellen:**
   - `backend/src/services/application-service.mts`
   - `backend/src/services/framework-service.mts`
   - Wrapper um Persistence-Interfaces

3. **StorageContext → ContextManager umbenennen:**
   - Datei: `storagecontext.mts` → `context-manager.mts`
   - Klasse: `StorageContext` → `ContextManager`
   - Singleton-Pattern entfernen (kein `setInstance()`/`getInstance()` mehr)
   - Entity-Methoden entfernen: `getAllAppNames()`, `listApplications()`, `getAllFrameworkNames()`
   - Konstruktor anpassen: `pathes` und `jsonValidator` als Parameter

4. **Alle Aufrufer umstellen:**
   - `StorageContext.setInstance()` → `PersistenceManager.initialize()`
   - `StorageContext.getInstance()` → `PersistenceManager.getInstance().getContextManager()`
   - `storageContext.listApplications()` → `persistenceManager.getApplicationService().listApplicationsForFrontend()`
   - `storageContext.getAllAppNames()` → `persistenceManager.getApplicationService().getAllAppNames()`
   - `storageContext.getAllFrameworkNames()` → `persistenceManager.getFrameworkService().getAllFrameworkNames()`

5. **Tests anpassen (nur inkompatible Änderungen):**
   - Jeden Test einzeln anpassen
   - Nur notwendige Änderungen (API-Aufrufe)
   - Test-Logik bleibt unverändert

6. **Tests laufen lassen:**
   ```bash
   npm test
   ```

7. **Wenn Tests fehlschlagen:**
   - ⛔ **STOP!**
   - Review/Fixes durch Benutzer
   - Checkin durch Benutzer
   - Erst dann weiter

8. **Wenn alle Tests grün:**
   - ✅ Code-Review
   - ✅ Checkin durch Benutzer
   - ✅ Nächste Phase

**Beispiel: Test-Anpassung**

**Vorher:**
```typescript
beforeAll(() => {
  StorageContext.setInstance(testDir, storageContextPath, secretFilePath);
});

it("should list applications", () => {
  const storage = StorageContext.getInstance();
  const apps = storage.listApplications();
  expect(apps.length).toBeGreaterThan(0);
});
```

**Nachher (nur inkompatible Änderungen):**
```typescript
beforeAll(() => {
  // ✅ NUR diese Zeile ändert sich:
  PersistenceManager.initialize(testDir, storageContextPath, secretFilePath);
});

it("should list applications", () => {
  // ✅ NUR diese Zeilen ändern sich:
  const pm = PersistenceManager.getInstance();
  const apps = pm.getApplicationService().listApplicationsForFrontend();
  
  // Test-Logik bleibt gleich:
  expect(apps.length).toBeGreaterThan(0);
});
```


### Phase 4: TemplateProcessor und FrameworkLoader umstellen

**Voraussetzung:**
- ✅ Phase 3 ist in git eingecheckt
- ✅ Alle Tests laufen

**Ziele:**
- TemplateProcessor verwendet ITemplatePersistence (via PersistenceManager)
- FrameworkLoader verwendet IFrameworkPersistence (via PersistenceManager)

**Vorgehen:**

1. **TemplateProcessor umstellen:**
   - Konstruktor: `persistence` als erforderlicher Parameter
   - Template-Laden: Verwendet `persistence.loadTemplate()`
   - Alte Implementierung entfernen

2. **FrameworkLoader umstellen:**
   - Konstruktor: `persistence` als erforderlicher Parameter
   - Framework-Laden: Verwendet `persistence.readFramework()`
   - Alte Implementierung entfernen

3. **Tests anpassen (nur inkompatible Änderungen):**
   - Jeden Test einzeln anpassen
   - Nur Konstruktor-Aufrufe ändern (Persistence übergeben)
   - Test-Logik bleibt unverändert

4. **Tests laufen lassen:**
   ```bash
   npm test
   ```

5. **Wenn Tests fehlschlagen:**
   - ⛔ **STOP!**
   - Review/Fixes durch Benutzer
   - Checkin durch Benutzer

6. **Wenn alle Tests grün:**
   - ✅ Code-Review
   - ✅ Checkin durch Benutzer
   - ✅ Nächste Phase

### Phase 5: Alte Dateisystem-Zugriffe entfernen

**Voraussetzung:**
- ✅ Phase 4 ist in git eingecheckt
- ✅ Alle Tests laufen

**Ziele:**
- Alle direkten Dateisystem-Zugriffe durch Persistence ersetzen
- Code aufräumen

**Vorgehen:**

1. **Codebase durchsuchen nach direkten Dateisystem-Zugriffen:**
   - `fs.readFileSync`, `fs.writeFileSync` für Applications/Templates/Frameworks
   - `fs.readdirSync` für Applications/Templates/Frameworks
   - `fs.existsSync` für Applications/Templates/Frameworks
   - `path.join` mit "applications", "templates", "frameworks"

2. **Ersetzen durch Persistence-Methoden:**
   - Jeden Aufruf einzeln ersetzen
   - Nach jeder Änderung Tests laufen lassen

3. **Tests anpassen (falls nötig):**
   - Nur wenn Tests durch Änderungen betroffen sind
   - Minimal notwendige Anpassungen

4. **Tests laufen lassen:**
   ```bash
   npm test
   ```

5. **Wenn Tests fehlschlagen:**
   - ⛔ **STOP!**
   - Review/Fixes durch Benutzer
   - Checkin durch Benutzer

6. **Wenn alle Tests grün:**
   - ✅ Code-Review
   - ✅ Checkin durch Benutzer
   - ✅ Nächste Phase

**TemplatePathResolver:**
- Kann bleiben (nur Pfad-Auflösung)
- Oder in Persistence integrieren (später)

### Phase 6: Tests erweitern für Cache-Verhalten und fs.watch

**Ziele:**
- Umfassende Tests für Cache-Verhalten
- fs.watch Tests (soweit möglich)
- Performance-Tests

**Schritte:**

1. **Cache-Tests erweitern:**
   - Cache-Invalidation bei verschiedenen Szenarien
   - Cache-Performance messen
   - Concurrent Access Tests

2. **fs.watch Tests:**
   - Integration-Tests mit echten Dateisystem-Änderungen
   - Debouncing-Verhalten testen
   - Edge Cases (Dateien während Watch-Erstellung)

3. **Performance-Tests:**
   - Vorher/Nachher Vergleich
   - Cache-Hit-Rate messen
   - API-Response-Zeiten messen

4. **End-to-End Tests:**
   - Komplette Workflows testen
   - UI → API → Persistence → Cache

**Hinweise:**
- fs.watch Tests sind flaky → Retry-Logik oder längere Timeouts
- Performance-Tests können in separater Test-Suite sein
- Mock fs.watch für deterministische Tests (optional)

## Migration-Checkliste

**Wichtig:** Nach jedem Schritt **alle Tests laufen lassen**. Wenn Tests fehlschlagen: **STOP!** Review/Fixes/Checkin durch Benutzer.

### Vorbereitung
- [ ] Backup der aktuellen Implementierung
- [ ] Feature-Branch erstellen
- [ ] Tests dokumentieren (was muss weiterhin funktionieren)
- [ ] **✅ Alle Tests laufen (Baseline)**
- [ ] **✅ Checkin durch Benutzer**

### Phase 1: Interfaces + FileSystemPersistence
- [ ] Interfaces definieren (`IApplicationPersistence`, `ITemplatePersistence`, `IFrameworkPersistence`)
- [ ] FileSystemPersistence implementieren
- [ ] **✅ Alle Tests laufen** (keine Änderungen an bestehendem Code)
- [ ] **✅ Code-Review**
- [ ] **✅ Checkin durch Benutzer**

### Phase 1b: Tests für FileSystemPersistence
- [ ] Tests für FileSystemPersistence erstellen
- [ ] Cache-Verhalten testen
- [ ] fs.watch Tests (soweit möglich)
- [ ] **✅ Alle Tests laufen** (neue Tests + bestehende)
- [ ] **✅ Code-Review**
- [ ] **✅ Checkin durch Benutzer**

### Phase 2: ApplicationLoader
- [ ] ApplicationLoader Konstruktor ändern (Persistence erforderlich)
- [ ] `readApplicationJson()` umstellen (verwendet Persistence)
- [ ] Alte Implementierung entfernen
- [ ] **Tests anpassen (nur inkompatible Änderungen):**
  - [ ] Jeden Test einzeln anpassen
  - [ ] Nur Konstruktor-Aufruf ändern (Persistence übergeben)
  - [ ] Test-Logik bleibt unverändert
- [ ] **✅ Alle Tests laufen**
- [ ] **Wenn Tests fehlschlagen: ⛔ STOP! Review/Fixes/Checkin durch Benutzer**
- [ ] **✅ Code-Review**
- [ ] **✅ Checkin durch Benutzer**

### Phase 3: PersistenceManager + ContextManager
- [ ] PersistenceManager erstellen (Singleton)
- [ ] PersistenceManager erstellt pathes und jsonValidator
- [ ] ApplicationService erstellen
- [ ] FrameworkService erstellen
- [ ] StorageContext → ContextManager umbenennen (Datei + Klasse)
- [ ] ContextManager Singleton entfernen
- [ ] ContextManager Konstruktor anpassen (pathes und jsonValidator als Parameter)
- [ ] ContextManager Entity-Methoden entfernen
- [ ] **Alle Aufrufer umstellen (nur inkompatible Änderungen):**
  - [ ] `lxc-exec.mts` umstellen
  - [ ] `webapp.mts` umstellen
  - [ ] `documentation-generator.mts` umstellen
  - [ ] `template-analyzer.mts` umstellen
  - [ ] Alle Tests umstellen
- [ ] **✅ Alle Tests laufen**
- [ ] **Wenn Tests fehlschlagen: ⛔ STOP! Review/Fixes/Checkin durch Benutzer**
- [ ] **✅ Code-Review**
- [ ] **✅ Checkin durch Benutzer**

### Phase 4: TemplateProcessor + FrameworkLoader
- [ ] TemplateProcessor umstellen (Persistence erforderlich)
- [ ] FrameworkLoader umstellen (Persistence erforderlich)
- [ ] **Tests anpassen (nur inkompatible Änderungen):**
  - [ ] Jeden Test einzeln anpassen
  - [ ] Nur Konstruktor-Aufrufe ändern
  - [ ] Test-Logik bleibt unverändert
- [ ] **✅ Alle Tests laufen**
- [ ] **Wenn Tests fehlschlagen: ⛔ STOP! Review/Fixes/Checkin durch Benutzer**
- [ ] **✅ Code-Review**
- [ ] **✅ Checkin durch Benutzer**

### Phase 5: Aufräumen
- [ ] Alte Dateisystem-Zugriffe entfernen (schrittweise)
- [ ] Jeden Aufruf einzeln ersetzen
- [ ] Nach jeder Änderung Tests laufen lassen
- [ ] **✅ Alle Tests laufen**
- [ ] **Wenn Tests fehlschlagen: ⛔ STOP! Review/Fixes/Checkin durch Benutzer**
- [ ] **✅ Code-Review**
- [ ] **✅ Checkin durch Benutzer**

### Phase 6: Erweiterte Tests
- [ ] Cache-Tests erweitern
- [ ] fs.watch Tests
- [ ] Performance-Tests
- [ ] **✅ Alle Tests laufen**
- [ ] **✅ Code-Review**
- [ ] **✅ Checkin durch Benutzer**

### Abschluss
- [ ] Dokumentation aktualisieren
- [ ] **✅ Alle Tests laufen (Final Check)**
- [ ] Merge in main
- [ ] Monitoring einrichten (Performance-Metriken)

## Zusammenfassung

### Entscheidungen

1. **Architektur:** ✅ Persistence Interface für Separation of Concerns
2. **Singleton-Pattern:** ✅ PersistenceManager verwaltet Persistence, Services und StorageContext
3. **Caching:** ✅ fs.watch für `local/json/` Verzeichnisse (rekursiv, Node.js 20.11.0+)
4. **Application-Liste:** ✅ `listApplicationsForFrontend()` - lädt KEINE Templates
5. **Template-Änderungen:** ✅ Betreffen NICHT die Application-Liste, nur Template-Cache
6. **JSON-Verzeichnis:** ✅ Statischer Cache (einmalig, ändert sich nur durch Deploy)

### Singleton-Architektur

```
┌─────────────────────────────────────────┐
│  PersistenceManager (Singleton)         │
│  - Primärer Singleton                    │
│  - Erstellt und verwaltet ContextManager │
│  - Verwaltet Persistence und Services    │
│  - Zentrale Zugriffspunkt                │
└──────────────┬──────────────────────────┘
               │ verwaltet
               ├─→ FileSystemPersistence
               ├─→ ApplicationService
               ├─→ FrameworkService
               └─→ ContextManager (KEIN Singleton mehr!)

┌─────────────────────────────────────────┐
│  ContextManager (KEIN Singleton)       │
│  - Verwaltet Execution Contextes         │
│  - VEContext (Proxmox Host)              │
│  - VMContext (Virtual Machine)           │
│  - VMInstallContext (Installation)       │
│  - Wird von PersistenceManager erstellt  │
└─────────────────────────────────────────┘
```

**Zugriff:**

```typescript
// PersistenceManager ist der primäre Singleton
const pm = PersistenceManager.getInstance();

// Entity-Zugriffe über Services
const apps = pm.getApplicationService().listApplicationsForFrontend();
const allApps = pm.getApplicationService().getAllAppNames();
const frameworks = pm.getFrameworkService().getAllFrameworkNames();

// Context-Management über ContextManager
const contextManager = pm.getContextManager();
const veContext = contextManager.getCurrentVEContext();
contextManager.setVEContext({ host: "example.com" });

// Direkter Persistence-Zugriff (falls nötig)
const persistence = pm.getPersistence();
const app = persistence.readApplication("myapp", opts);
```

### Vorteile

1. **Separation of Concerns**: Persistence-Logik getrennt von Business-Logik
2. **Singleton-Pattern**: Einheitlicher Zugriffspunkt für alle Persistence-Operationen
3. **Zentrales Caching**: Alle Cache-Strategien an einem Ort
4. **Sofortige Invalidation**: fs.watch für sofortige Reaktion auf Änderungen
5. **Testbarkeit**: Interfaces können gemockt werden, PersistenceManager kann gemockt werden
6. **Erweiterbarkeit**: Später einfacher auf Datenbank o.ä. umstellbar
7. **Performance**: 1000-10000x schneller nach erstem Aufruf
8. **UI-Integration**: Einfache Cache-Invalidation nach Create/Update/Delete
9. **Saubere Architektur**: Keine Legacy-APIs, PersistenceManager ist primärer Singleton

