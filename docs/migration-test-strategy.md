# Migration Test-Strategie

## Grundprinzipien

1. **Nach jedem Schritt müssen alle Tests laufen**
2. **Keine Fallbacks:** Tests werden sofort angepasst
3. **Nur inkompatible Änderungen:** Test-Logik bleibt unverändert
4. **Stop bei Fehlern:** Wenn Tests fehlschlagen → STOP, Review/Fixes/Checkin durch Benutzer

## Vorgehen pro Phase

### Vor jeder Phase
- [ ] `npm test` laufen lassen (Baseline)
- [ ] Alle Tests müssen grün sein
- [ ] Vorherige Phase ist in git eingecheckt

### Während der Phase
1. Code-Änderungen machen
2. Tests anpassen (nur inkompatible Änderungen)
3. `npm test` laufen lassen
4. **Wenn Tests fehlschlagen:**
   - ⛔ **STOP!**
   - Review/Fixes durch Benutzer
   - Checkin durch Benutzer
   - Erst dann weiter
5. **Wenn alle Tests grün:**
   - ✅ Code-Review
   - ✅ Checkin durch Benutzer
   - ✅ Nächste Phase

## Beispiel: Phase 2

### Code-Änderung

**ApplicationLoader:**
```typescript
// Vorher
constructor(
  private pathes: IConfiguredPathes,
  private storage: StorageContext = StorageContext.getInstance(),
) {}

// Nachher
constructor(
  private pathes: IConfiguredPathes,
  private persistence: IApplicationPersistence, // ERFORDERLICH
  private storage: StorageContext = StorageContext.getInstance(),
) {}

public readApplicationJson(...) {
  // Verwendet persistence.readApplication()
  return this.persistence.readApplication(application, opts);
}
```

### Test-Anpassung (nur inkompatible Änderung)

**Vorher:**
```typescript
beforeEach(() => {
  loader = new ApplicationLoader({ schemaPath, jsonPath, localPath });
});
```

**Nachher:**
```typescript
beforeEach(() => {
  // ✅ NUR diese Zeile ändert sich:
  const persistence = new FileSystemPersistence(
    { jsonPath, localPath, schemaPath },
    StorageContext.getInstance().getJsonValidator()
  );
  
  loader = new ApplicationLoader(
    { schemaPath, jsonPath, localPath },
    persistence // ✅ ERFORDERLICH
  );
  
  // Test-Logik bleibt unverändert!
});
```

### Test-Ausführung

```bash
npm test
```

**Wenn Tests fehlschlagen:**
- ⛔ **STOP!**
- Review/Fixes durch Benutzer
- Checkin durch Benutzer

**Wenn alle Tests grün:**
- ✅ Code-Review
- ✅ Checkin durch Benutzer
- ✅ Phase 3

## Checkliste pro Phase

- [ ] Code-Änderungen gemacht
- [ ] Tests angepasst (nur inkompatible Änderungen)
- [ ] `npm test` laufen lassen
- [ ] ✅ Alle Tests grün
- [ ] Code-Review
- [ ] Checkin durch Benutzer
- [ ] Nächste Phase

## Wichtige Regeln

1. **Keine Fallbacks:** Code wird direkt umgestellt, Tests werden angepasst
2. **Nur notwendige Änderungen:** Test-Logik bleibt unverändert
3. **Stop bei Fehlern:** Keine weiteren Änderungen bis Tests grün sind
4. **Checkin nach jeder Phase:** Nur wenn alle Tests grün sind

