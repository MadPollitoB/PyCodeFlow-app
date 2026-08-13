#Requires -Version 5.1
<#
.SYNOPSIS
    PyCodeFlow - Lokale mappenstructuur opschonen

.DESCRIPTION
    Verwijdert verouderde, ongebruikte en gegenereerde bestanden uit
    de lokale ontwikkelmap. Spiegelt de catalogus van actie_opschonen()
    in pycodeflow.sh (sprint 23r).

    Voer altijd uit vanuit de root van het PyCodeFlow project:
        cd D:\pad\naar\pycodeflow
        .\Opschonen-Lokaal.ps1

.PARAMETER DryRun
    Toont wat er verwijderd zou worden zonder iets te verwijderen.

.PARAMETER Force
    Geen bevestigingsvragen - direct verwijderen na de analysefase.

.PARAMETER LogRetentionDagen
    Logbestanden ouder dan dit aantal dagen worden verwijderd. Standaard 7.

.EXAMPLE
    .\Opschonen-Lokaal.ps1 -DryRun
    .\Opschonen-Lokaal.ps1
    .\Opschonen-Lokaal.ps1 -Force -LogRetentionDagen 14

.NOTES
    Versie     : v2026.2.23.0
    Catalogus  : Sprint 23r - sync met pycodeflow.sh actie_opschonen()
    Vereist    : PowerShell 5.1 of hoger
    Veiligheid : .env wordt NOOIT aangeraakt
#>

param(
    [switch]$DryRun,
    [switch]$Force,
    [int]$LogRetentionDagen = 7
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ============================================================
#  OPMAAK
# ============================================================

function Write-Header {
    Clear-Host
    Write-Host ""
    Write-Host "  PyCodeFlow - Lokale map opschonen" -ForegroundColor Cyan
    Write-Host "  v2026.2.23.0 - Sprint 23r" -ForegroundColor DarkCyan
    Write-Host "  ------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
    if ($DryRun) {
        Write-Host "  [DRY RUN] Er wordt niets verwijderd" -ForegroundColor Yellow
        Write-Host ""
    }
}

function Write-Stap([string]$Tekst) {
    Write-Host "  -- $Tekst" -ForegroundColor White
    Write-Host ""
}

function Write-Gevonden([string]$Naam, [string]$Reden, [string]$Sprint, [string]$Grootte) {
    Write-Host "  [X] $Naam ($Grootte)" -ForegroundColor Red
    Write-Host "      Reden  : $Reden" -ForegroundColor DarkGray
    Write-Host "      Sprint : $Sprint" -ForegroundColor DarkGray
    Write-Host ""
}

function Write-Optioneel([string]$Naam, [string]$Reden, [string]$Grootte) {
    Write-Host "  [?] $Naam ($Grootte)" -ForegroundColor Yellow
    Write-Host "      Reden  : $Reden" -ForegroundColor DarkGray
    Write-Host ""
}

function Write-Ok([string]$Tekst) {
    Write-Host "  [OK] $Tekst" -ForegroundColor Green
}

function Write-Info([string]$Tekst) {
    Write-Host "  [i]  $Tekst" -ForegroundColor DarkCyan
}

function Write-Waarschuw([string]$Tekst) {
    Write-Host "  [!]  $Tekst" -ForegroundColor Yellow
}

# ============================================================
#  BESTANDSGROOTTE - PS 5.1 compatibel (geen ?? of ?.)
# ============================================================

function Get-LeesbarGrootte([string]$Pad) {
    try {
        $bytes = 0
        if (Test-Path $Pad -PathType Container) {
            $meting = Get-ChildItem $Pad -Recurse -File -ErrorAction SilentlyContinue |
                      Measure-Object -Property Length -Sum
            if ($meting -and $meting.Sum) {
                $bytes = $meting.Sum
            }
        } else {
            $item = Get-Item $Pad -ErrorAction SilentlyContinue
            if ($item) {
                $bytes = $item.Length
            }
        }
        if ($bytes -lt 1)    { return "0 B" }
        if ($bytes -lt 1KB)  { return "$bytes B" }
        if ($bytes -lt 1MB)  { return ("{0:N1} KB" -f ($bytes / 1KB)) }
        if ($bytes -lt 1GB)  { return ("{0:N1} MB" -f ($bytes / 1MB)) }
        return ("{0:N2} GB" -f ($bytes / 1GB))
    } catch {
        return "?"
    }
}

function Get-ByteGrootte([string]$Pad) {
    try {
        if (Test-Path $Pad -PathType Container) {
            $meting = Get-ChildItem $Pad -Recurse -File -ErrorAction SilentlyContinue |
                      Measure-Object -Property Length -Sum
            if ($meting -and $meting.Sum) {
                return [long]$meting.Sum
            }
            return [long]0
        } else {
            $item = Get-Item $Pad -ErrorAction SilentlyContinue
            if ($item) {
                return [long]$item.Length
            }
            return [long]0
        }
    } catch {
        return [long]0
    }
}

function Remove-Veilig([string]$Pad) {
    if (-not (Test-Path $Pad)) { return [long]0 }
    $bytes = Get-ByteGrootte $Pad
    try {
        if (Test-Path $Pad -PathType Container) {
            Remove-Item $Pad -Recurse -Force -ErrorAction Stop
        } else {
            Remove-Item $Pad -Force -ErrorAction Stop
        }
        Write-Ok "Verwijderd: $(Split-Path $Pad -Leaf)"
    } catch {
        Write-Waarschuw "Kon niet verwijderen: $(Split-Path $Pad -Leaf)"
        return [long]0
    }
    return $bytes
}

# ============================================================
#  ROOTMAP VALIDATIE
# ============================================================

$Root = (Get-Location).Path

if (-not (Test-Path (Join-Path $Root "web\server.js")) -and
    -not (Test-Path (Join-Path $Root "docker-compose.yml")) -and
    -not (Test-Path (Join-Path $Root "pycodeflow.sh"))) {
    Write-Host ""
    Write-Host "  [!] Voer dit script uit vanuit de PyCodeFlow projectroot." -ForegroundColor Red
    Write-Host "      Huidig pad : $Root" -ForegroundColor DarkGray
    Write-Host "      Verwacht   : map met web\server.js en docker-compose.yml" -ForegroundColor DarkGray
    Write-Host ""
    exit 1
}

# ============================================================
#  CATALOGUS - VEROUDERDE PROJECTBESTANDEN
#  Sync met actie_opschonen() in pycodeflow.sh
#  Voeg hier bij elke sprint nieuwe entries toe.
# ============================================================

$CatalogusItems = @(
    @{
        Pad    = "runner\__pycache__"
        Naam   = "runner\__pycache__\"
        Reden  = "Python bytecode cache - wordt automatisch herschapen"
        Sprint = "22k"
    },
    @{
        Pad    = "start.bat"
        Naam   = "start.bat"
        Reden  = "Windows opstartscript - vervangen door pycodeflow.sh"
        Sprint = "23"
    },
    @{
        Pad    = "stop.bat"
        Naam   = "stop.bat"
        Reden  = "Windows stopscript - vervangen door pycodeflow.sh"
        Sprint = "23"
    },
    @{
        Pad    = "web\scripts\migrate-env-to-db.js"
        Naam   = "web\scripts\migrate-env-to-db.js"
        Reden  = "Eenmalig migratiescript (env naar SQLite) - voltooid in sprint 4"
        Sprint = "23"
    },
    @{
        Pad    = "web\scripts\migrate-sqlite-to-pg.js"
        Naam   = "web\scripts\migrate-sqlite-to-pg.js"
        Reden  = "Eenmalig migratiescript (SQLite naar PostgreSQL) - voltooid in sprint 12a"
        Sprint = "23"
    },
    @{
        Pad    = "web\scripts\hash-password.js"
        Naam   = "web\scripts\hash-password.js"
        Reden  = "Wachtwoord-hash hulpscript - vervangen door manage-teacher.js"
        Sprint = "23"
    },
    @{
        Pad    = "web\run_wrapper.py"
        Naam   = "web\run_wrapper.py"
        Reden  = "Legacy Python run-wrapper - niet meer in gebruik"
        Sprint = "23"
    }
)

# ============================================================
#  CATALOGUS - LOKAAL-SPECIFIEKE OPTIONELE ITEMS
#  Deze staan niet in pycodeflow.sh (bestaan niet op de NAS)
# ============================================================

$CatalogusOptioneel = @(
    @{
        Pad   = "web\node_modules"
        Naam  = "web\node_modules\"
        Reden = "npm build artifact - herstelbaar met: cd web && npm install"
    },
    @{
        Pad   = "web\public\monaco"
        Naam  = "web\public\monaco\"
        Reden = "Monaco editor build - herstelbaar via npm install in web/"
    },
    @{
        Pad   = "pgdata"
        Naam  = "pgdata\"
        Reden = "Lokale PostgreSQL databestanden - enkel voor lokale Docker instantie"
    },
    @{
        Pad   = ".vscode"
        Naam  = ".vscode\"
        Reden = "VS Code workspace instellingen - persoonlijk, niet in git"
    },
    @{
        Pad   = ".idea"
        Naam  = ".idea\"
        Reden = "JetBrains IDE instellingen - persoonlijk, niet in git"
    },
    @{
        Pad   = ".DS_Store"
        Naam  = ".DS_Store"
        Reden = "macOS metadata bestand"
    },
    @{
        Pad   = "Thumbs.db"
        Naam  = "Thumbs.db"
        Reden = "Windows thumbnail cache"
    }
)

# ============================================================
#  ANALYSE
# ============================================================

Write-Header
Write-Stap "Analyse - $Root"

$GevindenVerplicht = New-Object System.Collections.ArrayList
$GevindenOptioneel = New-Object System.Collections.ArrayList
$GevindenLogs      = New-Object System.Collections.ArrayList
$SqliteFiles       = @()
$HadVerplicht      = $false
$HadOptioneel      = $false

# -- Verouderde projectbestanden --
Write-Host "  Verouderde projectbestanden:" -ForegroundColor White
Write-Host ""

foreach ($item in $CatalogusItems) {
    $volledigPad = Join-Path $Root $item.Pad
    if (Test-Path $volledigPad) {
        $grootte = Get-LeesbarGrootte $volledigPad
        Write-Gevonden $item.Naam $item.Reden $item.Sprint $grootte
        $kopie = @{
            Pad        = $item.Pad
            Naam       = $item.Naam
            Reden      = $item.Reden
            Sprint     = $item.Sprint
            VolledigPad = $volledigPad
        }
        [void]$GevindenVerplicht.Add($kopie)
        $HadVerplicht = $true
    }
}

# -- SQLite legacy bestanden --
$dataPad = Join-Path $Root "data"
if (Test-Path $dataPad) {
    $SqliteFiles = @(Get-ChildItem $dataPad -File -ErrorAction SilentlyContinue |
                   Where-Object {
                       $_.Extension -eq '.db' -or
                       $_.Extension -eq '.sqlite' -or
                       $_.Extension -eq '.sqlite3' -or
                       $_.Name -like '*.db-shm' -or
                       $_.Name -like '*.db-wal' -or
                       $_.Name -like '*.db-journal'
                   })
    if ($SqliteFiles.Count -gt 0) {
        $grootte = Get-LeesbarGrootte $dataPad
        Write-Gevonden "data\ ($($SqliteFiles.Count) SQLite bestanden)" `
            "SQLite legacy - volledig vervangen door PostgreSQL (sprint 12a)" `
            "23" $grootte
        $HadVerplicht = $true
    }
}

# -- Stale logbestanden --
$logPad = Join-Path $Root "logs"
if (Test-Path $logPad) {
    $grens = (Get-Date).AddDays(-$LogRetentionDagen)
    $staleLogs = @(Get-ChildItem $logPad -Filter "*.log" -File -ErrorAction SilentlyContinue |
                 Where-Object { $_.LastWriteTime -lt $grens })
    if ($staleLogs.Count -gt 0) {
        $staleBytes = ($staleLogs | Measure-Object -Property Length -Sum).Sum
        if ($staleBytes -lt 1MB) {
            $grootteStr = "{0:N1} KB" -f ($staleBytes / 1KB)
        } else {
            $grootteStr = "{0:N1} MB" -f ($staleBytes / 1MB)
        }
        Write-Gevonden "logs\ ($($staleLogs.Count) stale logbestanden)" `
            "Verlopen retentie - ouder dan $LogRetentionDagen dagen" `
            "17a / 23p" $grootteStr
        foreach ($log in $staleLogs) {
            [void]$GevindenLogs.Add($log.FullName)
        }
        $HadVerplicht = $true
    }
}

if (-not $HadVerplicht) {
    Write-Host "  Geen verouderde projectbestanden gevonden." -ForegroundColor Green
    Write-Host ""
}

# -- Lokaal-specifieke optionele items --
Write-Host "  Lokaal-specifieke items (optioneel):" -ForegroundColor White
Write-Host ""

foreach ($item in $CatalogusOptioneel) {
    $volledigPad = Join-Path $Root $item.Pad
    if (Test-Path $volledigPad) {
        $grootte = Get-LeesbarGrootte $volledigPad
        Write-Optioneel $item.Naam $item.Reden $grootte
        $kopie = @{
            Pad         = $item.Pad
            Naam        = $item.Naam
            Reden       = $item.Reden
            VolledigPad = $volledigPad
        }
        [void]$GevindenOptioneel.Add($kopie)
        $HadOptioneel = $true
    }
}

if (-not $HadOptioneel) {
    Write-Host "  Geen lokale items gevonden." -ForegroundColor Green
    Write-Host ""
}

# -- Niets gevonden --
if (-not $HadVerplicht -and -not $HadOptioneel) {
    Write-Host "  Alles al netjes - geen verouderde bestanden gevonden." -ForegroundColor Green
    Write-Host ""
    exit 0
}

if ($DryRun) {
    Write-Host "  ------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  [DRY RUN] Analyse voltooid - niets verwijderd." -ForegroundColor Yellow
    Write-Host ""
    exit 0
}

# ============================================================
#  BEVESTIGING EN VERWIJDEREN
# ============================================================

Write-Host "  ------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

$TotaalVerwijderd = 0
$TotaalBytes      = [long]0

# -- Verouderde projectbestanden (samen bevestigen) --
if ($HadVerplicht) {
    if ($Force) {
        $antwoord = 'j'
    } else {
        $antwoord = Read-Host "  Verouderde projectbestanden verwijderen? (j/n)"
    }

    if ($antwoord -match '^[jJyY]$') {
        Write-Host ""
        Write-Stap "Verwijderen..."

        foreach ($item in $GevindenVerplicht) {
            $bytes = Remove-Veilig $item.VolledigPad
            $TotaalBytes += $bytes
            $TotaalVerwijderd++
        }

        if ($SqliteFiles.Count -gt 0) {
            foreach ($f in $SqliteFiles) {
                $bytes = Remove-Veilig $f.FullName
                $TotaalBytes += $bytes
                $TotaalVerwijderd++
            }
            $resterend = @(Get-ChildItem $dataPad -ErrorAction SilentlyContinue)
            if (-not $resterend -or $resterend.Count -eq 0) {
                Remove-Item $dataPad -Force -ErrorAction SilentlyContinue
                Write-Ok "Lege map verwijderd: data\"
            }
        }

        foreach ($log in $GevindenLogs) {
            $bytes = Remove-Veilig $log
            $TotaalBytes += $bytes
            $TotaalVerwijderd++
        }

    } else {
        Write-Waarschuw "Geannuleerd - projectbestanden niet verwijderd."
    }
    Write-Host ""
}

# -- Optionele lokale items (elk apart bevestigen) --
if ($HadOptioneel) {
    Write-Host "  ------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Optionele lokale items (elk apart):" -ForegroundColor White
    Write-Host ""

    foreach ($item in $GevindenOptioneel) {
        $grootte = Get-LeesbarGrootte $item.VolledigPad
        if ($Force) {
            $antwoord = 'j'
        } else {
            $antwoord = Read-Host "  $($item.Naam) ($grootte) verwijderen? (j/n)"
        }

        if ($antwoord -match '^[jJyY]$') {
            $bytes = Remove-Veilig $item.VolledigPad
            $TotaalBytes += $bytes
            $TotaalVerwijderd++
        } else {
            Write-Info "Overgeslagen: $($item.Naam)"
        }
    }
    Write-Host ""
}

# ============================================================
#  RAPPORT
# ============================================================

if ($TotaalBytes -lt 1KB) {
    $vrijgemaaktStr = "$TotaalBytes B"
} elseif ($TotaalBytes -lt 1MB) {
    $vrijgemaaktStr = "{0:N1} KB" -f ($TotaalBytes / 1KB)
} elseif ($TotaalBytes -lt 1GB) {
    $vrijgemaaktStr = "{0:N1} MB" -f ($TotaalBytes / 1MB)
} else {
    $vrijgemaaktStr = "{0:N2} GB" -f ($TotaalBytes / 1GB)
}

Write-Host "  ------------------------------------------------" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Opschonen voltooid" -ForegroundColor Green
Write-Ok "$TotaalVerwijderd item(s) verwijderd - $vrijgemaaktStr vrijgemaakt"
Write-Host ""
Write-Info ".env is nooit aangeraakt - wachtwoorden en tokens intact."
Write-Host ""

# ============================================================
#  SPRINT-CATALOGUS UITBREIDEN
# ============================================================
# Bij elke nieuwe sprint: voeg een nieuwe @{} entry toe aan
# $CatalogusItems bovenaan dit script met Pad, Naam, Reden
# en Sprint. Sync altijd ook met actie_opschonen() in
# pycodeflow.sh.
# ============================================================
