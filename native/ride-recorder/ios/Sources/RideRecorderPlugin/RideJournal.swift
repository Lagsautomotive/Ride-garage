import Foundation

enum RideStatus: String, Codable {
    case recording, paused, stopped, interrupted
}

struct RidePoint: Codable, Equatable {
    let latitude: Double
    let longitude: Double
    let timestamp: Double
    let accuracy: Double
    let speed: Double?
    var segment: Int
}

struct RideSession {
    let id: String
    var name: String
    var country: String
    let startedAt: Double
    var endedAt: Double?
    var status: RideStatus
    var points: [RidePoint]
    var durationMs: Double
    var lastError: String?
    var activeSince: Double?
    var segment: Int
}

enum RideJournalError: LocalizedError {
    case invalidState(String)
    case corrupt
    case storageUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidState(let message): return message
        case .corrupt: return "The local ride journal is damaged. It has been preserved; recording is disabled to protect it."
        case .storageUnavailable: return "Ride storage failed. Tracking stopped. Free storage and reopen the app to recover the saved portion."
        }
    }
}

/// A single writer, append-only, versioned journal. Call only from one serial executor.
/// Every successful mutation is on disk before it becomes visible to callers.
final class RideJournal {
    private struct Event: Codable {
        enum Kind: String, Codable { case start, point, pause, resume, stop, interrupt, metadata }
        var version = 1
        let kind: Kind
        let at: Double
        var id: String?
        var name: String?
        var country: String?
        var point: RidePoint?
        var reason: String?
    }

    private let directory: URL
    private let fileURL: URL
    private(set) var session: RideSession?
    private var lastEventAt: Double = 0
    private var poisoned = false
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(directory: URL) throws {
        self.directory = directory
        self.fileURL = directory.appendingPathComponent("ride.jsonl", isDirectory: false)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try protect(directory)
        var excludedDirectory = directory
        var resourceValues = URLResourceValues()
        resourceValues.isExcludedFromBackup = true
        try excludedDirectory.setResourceValues(resourceValues)
        if FileManager.default.fileExists(atPath: fileURL.path) {
            try protect(fileURL)
            try replay()
            if session?.status == .recording {
                try commit(Event(kind: .interrupt, at: lastEventAt,
                                 reason: "Recording was interrupted. The saved route is available; Resume starts a new segment."))
            }
        }
    }

    func snapshot(at now: Double) -> RideSession? {
        guard var result = session else { return nil }
        if result.status == .recording, let since = result.activeSince {
            result.durationMs += max(0, now - since)
        }
        return result
    }

    func start(name: String, country: String, at now: Double, id: String = UUID().uuidString) throws {
        guard session == nil else {
            throw RideJournalError.invalidState("Save the existing ride before starting another.")
        }
        try commit(Event(kind: .start, at: now, id: id, name: clean(name, fallback: "Ride"),
                         country: clean(country, fallback: "")))
    }

    func pause(at now: Double) throws {
        guard session?.status == .recording else {
            throw RideJournalError.invalidState("Only a recording ride can be paused.")
        }
        try commit(Event(kind: .pause, at: now))
    }

    func resume(at now: Double) throws {
        guard session?.status == .paused || session?.status == .interrupted else {
            throw RideJournalError.invalidState("Only a paused or interrupted ride can be resumed.")
        }
        try commit(Event(kind: .resume, at: now))
    }

    func stop(at now: Double) throws {
        guard let current = session else {
            throw RideJournalError.invalidState("No ride is available to stop.")
        }
        if current.status == .stopped { return }
        try commit(Event(kind: .stop, at: now))
    }

    func interrupt(at now: Double, reason: String) throws {
        guard session?.status == .recording else { return }
        try commit(Event(kind: .interrupt, at: now, reason: reason))
    }

    func updateMetadata(name: String, country: String, at now: Double) throws {
        guard session != nil else { throw RideJournalError.invalidState("No ride is available.") }
        try commit(Event(kind: .metadata, at: now, name: clean(name, fallback: "Ride"),
                         country: clean(country, fallback: "")))
    }

    @discardableResult
    func append(_ location: RidePoint, receivedAt now: Double) throws -> Bool {
        guard let point = preparedPoint(location, receivedAt: now) else { return false }
        try commit(Event(kind: .point, at: now, point: point))
        return true
    }

    // Return only one point; do not retain the session/array across the durable append.
    private func preparedPoint(_ location: RidePoint, receivedAt now: Double) -> RidePoint? {
        guard let current = session, current.status == .recording,
              let activeSince = current.activeSince else { return nil }
        guard now.isFinite, location.latitude.isFinite, abs(location.latitude) <= 90,
              location.longitude.isFinite, abs(location.longitude) <= 180,
              location.timestamp.isFinite, location.timestamp >= activeSince,
              location.timestamp <= now + 10_000,
              location.accuracy.isFinite, location.accuracy >= 0,
              location.speed == nil || (location.speed!.isFinite && location.speed! >= 0)
        else { return nil }
        if let last = current.points.last, location.timestamp <= last.timestamp { return nil }
        var point = location
        point.segment = current.segment
        if let last = current.points.last,
           last.segment == current.segment, point.timestamp - last.timestamp > 30_000 {
            point.segment += 1
        }
        return point
    }

    // This temporary state alias is released before the caller mutates its points.
    private func validatePoint(_ event: Event, against state: RideSession?) throws {
        guard event.version == 1, event.at.isFinite, event.at >= 0,
              let current = state, current.status == .recording,
              event.at >= current.startedAt, let point = event.point,
              point.latitude.isFinite, abs(point.latitude) <= 90,
              point.longitude.isFinite, abs(point.longitude) <= 180,
              point.timestamp.isFinite,
              point.timestamp >= (current.activeSince ?? current.startedAt),
              point.timestamp <= event.at + 10_000,
              point.accuracy.isFinite, point.accuracy >= 0,
              point.speed == nil || (point.speed!.isFinite && point.speed! >= 0),
              point.segment == current.segment || point.segment == current.segment + 1,
              current.points.last.map({ point.timestamp > $0.timestamp }) ?? true
        else { throw RideJournalError.corrupt }
    }

    func acknowledge(id: String) throws {
        guard let current = session, current.id == id, current.status == .stopped else {
            throw RideJournalError.invalidState("Only the matching saved, stopped ride can be acknowledged.")
        }
        guard !poisoned else { throw RideJournalError.storageUnavailable }
        try FileManager.default.removeItem(at: fileURL)
        session = nil
        lastEventAt = 0
    }

    func failClosed(at now: Double, reason: String) {
        poisoned = true
        guard var current = session, current.status != .stopped else { return }
        if let since = current.activeSince { current.durationMs += max(0, now - since) }
        current.activeSince = nil
        current.status = .interrupted
        current.lastError = reason
        session = current
    }

    private func clean(_ text: String, fallback: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : String(trimmed.prefix(160))
    }

    private func protect(_ url: URL) throws {
        #if os(iOS)
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: url.path
        )
        #endif
    }

    private func sync(_ url: URL) throws {
        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        try handle.synchronize()
    }

    private func commit(_ event: Event) throws {
        guard !poisoned else { throw RideJournalError.storageUnavailable }
        let next: RideSession?
        if event.kind == .point {
            try validatePoint(event, against: session)
            next = nil
        } else {
            next = try reduce(event, into: session)
        }
        var data = try encoder.encode(event)
        data.append(0x0a)
        do {
            if event.kind == .start {
                guard !FileManager.default.fileExists(atPath: fileURL.path) else {
                    throw RideJournalError.corrupt
                }
                try data.write(to: fileURL, options: .atomic)
                try protect(fileURL)
                try sync(fileURL)
            } else {
                let handle = try FileHandle(forWritingTo: fileURL)
                defer { try? handle.close() }
                _ = try handle.seekToEnd()
                try handle.write(contentsOf: data)
                try handle.synchronize()
            }
        } catch {
            poisoned = true
            throw error
        }
        if event.kind == .point, let point = event.point {
            // No stored snapshot aliases exist on this path: amortised O(1).
            session!.points.append(point)
            session!.segment = point.segment
        } else {
            session = next
        }
        lastEventAt = event.at
    }

    private func replay() throws {
        let data = try Data(contentsOf: fileURL)
        var cursor = data.startIndex
        var recovered: RideSession?
        while cursor < data.endIndex, let newline = data[cursor...].firstIndex(of: 0x0a) {
            guard newline > cursor else { throw RideJournalError.corrupt }
            let event: Event
            do { event = try decoder.decode(Event.self, from: Data(data[cursor..<newline])) }
            catch { throw RideJournalError.corrupt }
            if event.kind == .point, let point = event.point {
                try validatePoint(event, against: recovered)
                recovered!.points.append(point)
                recovered!.segment = point.segment
            } else {
                recovered = try reduce(event, into: recovered)
            }
            lastEventAt = event.at
            cursor = data.index(after: newline)
        }
        guard recovered != nil else { throw RideJournalError.corrupt }
        if cursor < data.endIndex {
            let tailURL = directory.appendingPathComponent("incomplete-tail-" + UUID().uuidString + ".bin")
            try Data(data[cursor...]).write(to: tailURL, options: .atomic)
            try protect(tailURL)
            try sync(tailURL)
            let handle = try FileHandle(forWritingTo: fileURL)
            defer { try? handle.close() }
            try handle.truncate(atOffset: UInt64(cursor))
            try handle.synchronize()
        }
        session = recovered
    }

    private func reduce(_ event: Event, into state: RideSession?) throws -> RideSession {
        guard event.version == 1, event.at.isFinite, event.at >= 0 else { throw RideJournalError.corrupt }
        if event.kind == .start {
            guard state == nil, let id = event.id, !id.isEmpty,
                  let name = event.name, let country = event.country else { throw RideJournalError.corrupt }
            return RideSession(id: id, name: name, country: country, startedAt: event.at,
                               status: .recording, points: [], durationMs: 0,
                               activeSince: event.at, segment: 0)
        }
        guard var current = state, event.at >= current.startedAt else { throw RideJournalError.corrupt }
        switch event.kind {
        case .start: throw RideJournalError.corrupt
        case .point:
            // Point events use the in-place path in both commit and replay.
            throw RideJournalError.corrupt
        case .resume:
            guard current.status == .paused || current.status == .interrupted else { throw RideJournalError.corrupt }
            current.status = .recording
            current.activeSince = event.at
            current.segment += 1
            current.lastError = nil
        case .pause, .interrupt, .stop:
            if event.kind != .stop, current.status != .recording { throw RideJournalError.corrupt }
            guard current.status != .stopped else { throw RideJournalError.corrupt }
            if let since = current.activeSince { current.durationMs += max(0, event.at - since) }
            current.activeSince = nil
            if event.kind == .stop {
                current.status = .stopped
                current.endedAt = event.at
            } else if event.kind == .pause {
                current.status = .paused
            } else {
                current.status = .interrupted
                current.lastError = event.reason
            }
        case .metadata:
            guard let name = event.name, let country = event.country else { throw RideJournalError.corrupt }
            current.name = name
            current.country = country
        }
        return current
    }
}
