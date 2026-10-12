# Icono y Pantalla de Arranque (Tema Oscuro)

Esta carpeta contiene las imágenes maestras que el workflow de GitHub Actions (`.github/workflows/build-ios.yml`) inyecta automáticamente en el catálogo de recursos de iOS (`ios/App/App/Assets.xcassets`) antes de compilar:

- **`assets/icon.png`** (`1024 × 1024 px`, formato PNG **sin transparencia / sin canal alfa**):
  - **MARCADOR DE SUSTITUCIÓN**: Sustituye este archivo por tu propio icono manteniendo el nombre `assets/icon.png` y resolución `1024×1024`.
- **`assets/splash.png`** (`2732 × 2732 px`, formato PNG en tema oscuro `#1e1f23`):
  - **MARCADOR DE SUSTITUCIÓN**: Sustituye este archivo si deseas personalizar la pantalla de arranque.

> En el runner `macos-26`, el paso `Apply custom dark icon and splash screen` utiliza `sips` (herramienta nativa de macOS) para redimensionar y copiar automáticamente `assets/icon.png` y `assets/splash.png` dentro de `AppIcon.appiconset` y `Splash.imageset`.
