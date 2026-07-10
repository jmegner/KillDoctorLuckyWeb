$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$boardDir = Join-Path $repoRoot "src\data\boards"
$outputPath = Join-Path $PSScriptRoot "relative_movement.csv"

function Get-ShortestDistances {
    param(
        [int] $StartRoomId,
        [hashtable] $AdjacentByRoomId
    )

    $distances = @{}
    $distances[$StartRoomId] = 0
    $queue = [System.Collections.Generic.Queue[int]]::new()
    $queue.Enqueue($StartRoomId)

    while ($queue.Count -gt 0) {
        $current = $queue.Dequeue()
        $currentDistance = $distances[$current]

        foreach ($neighbor in $AdjacentByRoomId[$current]) {
            if (-not $distances.ContainsKey($neighbor)) {
                $distances[$neighbor] = $currentDistance + 1
                $queue.Enqueue($neighbor)
            }
        }
    }

    return $distances
}

$lines = [System.Collections.Generic.List[string]]::new()
$boardFiles = Get-ChildItem -Path $boardDir -Filter "*.json" | Sort-Object Name

foreach ($boardFile in $boardFiles) {
    $board = Get-Content -Path $boardFile.FullName -Raw | ConvertFrom-Json
    $rooms = $board.Rooms |
        ForEach-Object {
            [pscustomobject]@{
                Id = [int]$_.Id
                Adjacent = @($_.Adjacent | ForEach-Object { [int]$_ })
            }
        } |
        Sort-Object Id

    $roomIds = @($rooms | ForEach-Object { $_.Id })
    $stepOffsets = 1..($roomIds.Count - 1)
    $header = (@(
        "RoomId"
        "NumAdjacent"
        "AdjacentRoomsInRelativeDrOrder"
    ) + @($stepOffsets | ForEach-Object { "$_`StepsToRoomN+$_" })) -join ","

    $doctorOrderIndex = @{}
    for ($index = 0; $index -lt $roomIds.Count; $index++) {
        $doctorOrderIndex[$roomIds[$index]] = $index
    }

    $adjacentByRoomId = @{}
    foreach ($room in $rooms) {
        $adjacentByRoomId[$room.Id] = @($room.Adjacent)
    }

    $lines.Add($board.Name)
    $lines.Add($header)

    foreach ($room in $rooms) {
        $currentIndex = $doctorOrderIndex[$room.Id]
        $relativeAdjacent = @(
            foreach ($adjacentRoomId in $room.Adjacent) {
                if (-not $doctorOrderIndex.ContainsKey($adjacentRoomId)) {
                    throw "$($board.Name) room $($room.Id) has unknown adjacent room $adjacentRoomId"
                }

                ($doctorOrderIndex[$adjacentRoomId] - $currentIndex + $roomIds.Count) % $roomIds.Count
            }
        ) | Sort-Object { $_ }

        $distances = Get-ShortestDistances -StartRoomId $room.Id -AdjacentByRoomId $adjacentByRoomId
        $stepColumns = @(
            foreach ($offset in $stepOffsets) {
                $targetRoomId = $roomIds[($currentIndex + $offset) % $roomIds.Count]
                if (-not $distances.ContainsKey($targetRoomId)) {
                    throw "$($board.Name) room $($room.Id) cannot reach N+$offset room $targetRoomId"
                }

                $distances[$targetRoomId]
            }
        )

        $columns = @(
            $room.Id
            $room.Adjacent.Count
            ($relativeAdjacent -join ";")
        ) + $stepColumns

        $lines.Add($columns -join ",")
    }
}

$outputDir = Split-Path -Path $outputPath -Parent
if (-not (Test-Path -Path $outputDir)) {
    New-Item -Path $outputDir -ItemType Directory | Out-Null
}

Set-Content -Path $outputPath -Value $lines -Encoding ascii
