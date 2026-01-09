# ⚠️ DEPRECATED - Siehe persistence-and-caching-proposal.md

Dieses Dokument wurde mit `application-cache-proposal.md` zu einem konsolidierten Dokument zusammengeführt: **`persistence-and-caching-proposal.md`**

---

# Persistence Interface - Analyse und Vorschlag

## Aktuelle Architektur-Analyse

### Problem: Vermischte Concerns

**StorageContext** hat aktuell zwei verschiedene Verantwortlichkeiten:
1. **Context-Management** (VE, VM, VMInstall) - Persistenz in `storagecontext.json`
2. **Entity-Loading** (Applications, Templates, Frameworks) - Dateisystem-Zugriff

**Weitere Probleme:**
- Dateisystem-Zugriff ist über viele Klassen verstreut:
  - `ApplicationLoader` - liest `application.json`
  - `FrameworkLoader` - liest `framework.json`
  - `TemplateProcessor` - liest Templates
  - `TemplatePathResolver` - findet Template-Pfade
  - `StorageContext` - listet Applications/Frameworks
- Keine zentrale Caching-Strategie
- Schwer testbar (direkte FS-Abhängigkeiten)
- Keine klare Abstraktion für Persistenz

### Hauptentitäten

1. **Applications**
   - Location: `json/applications/` (read-only) und `local/json/applications/` (mutable)
   - Format: `application.json` + optional `icon.png/svg`
   - Loader: `ApplicationLoader`, `StorageContext.getAllAppNames()`, `StorageContext.listApplications()`

2. **Templates**
   - Location: `json/shared/templates/`, `json/applications/{app}/templates/`, `local/json/applications/{app}/templates/`
   - Format: `*.json` Dateien
   - Loader: `TemplateProcessor`, `TemplatePathResolver`

3. **Frameworks**
   - Location: `json/frameworks/` (read-only) und `local/json/frameworks/` (mutable)
   - Format: `{frameworkId}.json`
   - Loader: `FrameworkLoader`, `StorageContext.getAllFrameworkNames()`

4. **Contextes** (VE, VM, VMInstall)
   - Location: `local/json/storagecontext.json`
   - Format: JSON (optional verschlüsselt)
   - Loader: `Context`, `StorageContext`

## Vorschlag: Persistence Interface

### Architektur-Überlegungen

**Separation of Concerns:**
- **Persistence Layer**: Verantwortlich für Lesen/Schreiben von Entities
- **Business Logic Layer**: Verarbeitet Entities (ApplicationLoader, TemplateProcessor, etc.)
- **Context Layer**: Nur für Context-Management (VE, VM, VMInstall)

### Interface-Design

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
   * Cached: JSON directory cached permanently, local directory cached with mtime-check
   */
  getAllAppNames(): Map<string, string>;
  
  /**
   * Lists all applications with full data (for UI)
   * Cached: Full list cached, invalidated when local applications change
   */
  listApplications(): IApplicationWeb[];
  
  /**
   * Reads a single application.json file
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
   * Cached: JSON directory cached permanently, local directory cached with mtime-check
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

/**
 * Persistence for Contextes (VE, VM, VMInstall)
 * Note: This might stay in Context/StorageContext as it's a different concern
 */
interface IContextPersistence {
  // Context operations (already in Context class)
  // Could be extracted if needed, but probably not necessary
}
```

### Implementierung: FileSystemPersistence

```typescript
/**
 * File system implementation of persistence interfaces
 * Handles caching and file system operations
 */
class FileSystemPersistence implements IApplicationPersistence, ITemplatePersistence, IFrameworkPersistence {
  private appNamesCache: {
    json: Map<string, string> | null;
    local: Map<string, string> | null;
    localMtimes: Map<string, number>;
  } = {
    json: null,
    local: null,
    localMtimes: new Map(),
  };
  
  private applicationsListCache: IApplicationWeb[] | null = null;
  private applicationCache: Map<string, { data: IApplication; mtime: number }> = new Map();
  private frameworkCache: Map<string, { data: IFramework; mtime: number }> = new Map();
  private templateCache: Map<string, { data: ITemplate; mtime: number }> = new Map();
  
  constructor(
    private pathes: IConfiguredPathes,
    private jsonValidator: JsonValidator,
  ) {}
  
  // IApplicationPersistence
  getAllAppNames(): Map<string, string> {
    // JSON: Einmalig laden
    if (this.appNamesCache.json === null) {
      this.appNamesCache.json = this.scanApplicationsDir(this.pathes.jsonPath);
    }
    
    // Local: Prüfen ob geändert
    const localAppsDir = path.join(this.pathes.localPath, "applications");
    if (this.appNamesCache.local === null || this.hasLocalChanged(localAppsDir)) {
      this.appNamesCache.local = this.scanApplicationsDir(this.pathes.localPath);
      this.updateLocalMtimes(localAppsDir);
    }
    
    // Merge: Local hat Priorität
    const result = new Map(this.appNamesCache.json);
    if (this.appNamesCache.local) {
      for (const [name, appPath] of this.appNamesCache.local) {
        result.set(name, appPath);
      }
    }
    return result;
  }
  
  listApplications(): IApplicationWeb[] {
    if (this.applicationsListCache === null || this.hasLocalApplicationsChanged()) {
      this.applicationsListCache = this.buildApplicationList();
    }
    return this.applicationsListCache;
  }
  
  readApplication(applicationName: string, opts: IReadApplicationOptions): IApplication {
    // Check cache first
    const appPath = this.getAllAppNames().get(applicationName);
    if (!appPath) {
      throw new Error(`Application ${applicationName} not found`);
    }
    
    const appFile = path.join(appPath, "application.json");
    const mtime = fs.statSync(appFile).mtimeMs;
    
    // Check if cached and still valid
    const cached = this.applicationCache.get(applicationName);
    if (cached && cached.mtime === mtime) {
      // Return cached, but need to process templates/inheritance
      // This might need special handling
      return cached.data;
    }
    
    // Load and cache
    const appData = this.jsonValidator.serializeJsonFileWithSchema<IApplication>(
      appFile,
      "application",
    );
    this.applicationCache.set(applicationName, { data: appData, mtime });
    return appData;
  }
  
  writeApplication(applicationName: string, application: IApplication): void {
    const appDir = path.join(this.pathes.localPath, "applications", applicationName);
    fs.mkdirSync(appDir, { recursive: true });
    
    const appFile = path.join(appDir, "application.json");
    fs.writeFileSync(appFile, JSON.stringify(application, null, 2));
    
    // Invalidate caches
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
    this.frameworkCache.clear();
    this.templateCache.clear();
  }
  
  // Helper methods
  private hasLocalChanged(localAppsDir: string): boolean {
    if (!fs.existsSync(localAppsDir)) return false;
    
    const currentApps = this.scanApplicationsDirWithMtimes(this.pathes.localPath);
    
    // Check if count changed
    if (currentApps.size !== this.appNamesCache.localMtimes.size) {
      return true;
    }
    
    // Check if mtimes changed
    for (const [name, mtime] of this.appNamesCache.localMtimes) {
      const currentMtime = currentApps.get(name);
      if (currentMtime === undefined || currentMtime !== mtime) {
        return true;
      }
    }
    return false;
  }
  
  private invalidateApplicationCache(applicationName: string): void {
    this.appNamesCache.local = null;
    this.applicationsListCache = null;
    this.applicationCache.delete(applicationName);
  }
}
```

### Integration in bestehende Klassen

**ApplicationLoader:**
```typescript
export class ApplicationLoader {
  constructor(
    private pathes: IConfiguredPathes,
    private persistence: IApplicationPersistence, // Statt StorageContext
    private storage: StorageContext = StorageContext.getInstance(),
  ) {}
  
  public readApplicationJson(
    application: string,
    opts: IReadApplicationOptions,
  ): IApplication {
    // Verwendet persistence.readApplication()
    return this.persistence.readApplication(application, opts);
  }
}
```

**StorageContext:**
```typescript
export class StorageContext extends Context implements IContext {
  private persistence: FileSystemPersistence;
  
  constructor(
    localPath: string,
    storageContextFilePath: string,
    secretFilePath: string,
  ) {
    super(storageContextFilePath, secretFilePath);
    // ... existing code ...
    
    // Initialize persistence
    this.persistence = new FileSystemPersistence(this.pathes, this.jsonValidator);
  }
  
  // Delegiert an Persistence
  getAllAppNames(): Map<string, string> {
    return this.persistence.getAllAppNames();
  }
  
  listApplications(): IApplicationWeb[] {
    return this.persistence.listApplications();
  }
  
  getAllFrameworkNames(): Map<string, string> {
    return this.persistence.getAllFrameworkNames();
  }
  
  // Manuelle Invalidation (z.B. nach Framework-Create)
  invalidateApplicationCache(): void {
    this.persistence.invalidateCache();
  }
}
```

## Vorteile

1. **Separation of Concerns**: Persistence-Logik ist getrennt von Business-Logik
2. **Zentrales Caching**: Alle Cache-Strategien an einem Ort
3. **Testbarkeit**: Interfaces können gemockt werden
4. **Erweiterbarkeit**: Später einfacher auf Datenbank o.ä. umstellbar
5. **Klarheit**: StorageContext ist nur noch für Context-Management zuständig
6. **UI-Integration**: Einfache Cache-Invalidation nach Create/Update/Delete

## Migration-Strategie

1. **Phase 1**: Interfaces definieren, FileSystemPersistence implementieren
2. **Phase 2**: ApplicationLoader auf Persistence umstellen
3. **Phase 3**: StorageContext delegiert an Persistence
4. **Phase 4**: TemplateProcessor und FrameworkLoader umstellen
5. **Phase 5**: Alte Dateisystem-Zugriffe entfernen

## Offene Fragen

1. Soll `Context`-Persistence auch ins Interface? (Wahrscheinlich nicht nötig)
2. Soll es ein zentrales `IPersistenceManager` geben, das alle Interfaces kombiniert?
3. Wie soll Caching für Templates gehandhabt werden? (Viele Templates, aber selten geändert)

