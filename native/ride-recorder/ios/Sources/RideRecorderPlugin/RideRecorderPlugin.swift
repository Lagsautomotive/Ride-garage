import Foundation
import Capacitor
import CoreLocation
import UIKit

@objc(RideRecorderPlugin)
public final class RideRecorderPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "RideRecorderPlugin"
    public let jsName = "RideRecorder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateMetadata", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledge", returnType: CAPPluginReturnPromise)
    ]

    private enum PendingAction {
        case start(name: String, country: String)
        case resume
    }
    private var journal: RideJournal?
    private var manager: CLLocationManager?
    private var initializationError: Error?
    private var initialized = false
    private var pendingCall: CAPPluginCall?
    private var pendingAction: PendingAction?
    private var activeObserver: NSObjectProtocol?
    private var lastNotificationAt: Double = 0

    public override func load() {
        onMain { [weak self] in
            guard let self = self else { return }
            do { try self.prepare() }
            catch { self.initializationError = error }
        }
    }

    deinit {
        if let observer = activeObserver { NotificationCenter.default.removeObserver(observer) }
    }

    private func onMain(_ operation: @escaping () -> Void) {
        if Thread.isMainThread { operation() }
        else { DispatchQueue.main.async(execute: operation) }
    }

    private func now() -> Double { Date().timeIntervalSince1970 * 1_000 }

    private func prepare() throws {
        precondition(Thread.isMainThread)
        if initialized {
            if let error = initializationError { throw error }
            return
        }
        initialized = true
        do {
            let root = try FileManager.default.url(for: .applicationSupportDirectory,
                                                   in: .userDomainMask, appropriateFor: nil, create: true)
            journal = try RideJournal(directory: root.appendingPathComponent("RideGarageRecorder", isDirectory: true))
            let locationManager = CLLocationManager()
            manager = locationManager
            locationManager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
            locationManager.distanceFilter = kCLDistanceFilterNone
            locationManager.activityType = .automotiveNavigation
            locationManager.pausesLocationUpdatesAutomatically = false
            locationManager.showsBackgroundLocationIndicator = true
            locationManager.delegate = self
            activeObserver = NotificationCenter.default.addObserver(
                forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
            ) { [weak self] _ in
                guard let self = self else { return }
                self.finishPermissionRequest()
                self.checkRecordingAuthorization()
                self.notifyCurrent(force: true)
            }
        } catch {
            initializationError = error
            throw error
        }
    }

    @objc public func start(_ call: CAPPluginCall) {
        onMain { [weak self] in
            guard let self = self else { return }
            self.beginExplicitAction(call, action: .start(name: call.getString("name") ?? "Ride",
                                                         country: call.getString("country") ?? ""))
        }
    }

    @objc public func resume(_ call: CAPPluginCall) {
        onMain { [weak self] in self?.beginExplicitAction(call, action: .resume) }
    }

    private func beginExplicitAction(_ call: CAPPluginCall, action: PendingAction) {
        do {
            try prepare()
            guard pendingCall == nil else {
                call.reject("A location permission request is already in progress.", "RECORDER_BUSY")
                return
            }
            guard UIApplication.shared.applicationState == .active else {
                call.reject("Open the app to start or resume recording.", "FOREGROUND_REQUIRED")
                return
            }
            switch action {
            case .start:
                guard journal?.session == nil else {
                    call.reject("Save the existing ride before starting another.", "RIDE_EXISTS")
                    return
                }
            case .resume:
                guard journal?.session?.status == .paused || journal?.session?.status == .interrupted else {
                    call.reject("Only a paused or interrupted ride can be resumed.", "INVALID_STATE")
                    return
                }
            }
            guard let manager = manager else { throw RideJournalError.storageUnavailable }
            guard let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String],
                  modes.contains("location"),
                  Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") != nil else {
                call.reject("This build is missing its background location configuration.", "LOCATION_CONFIGURATION")
                return
            }
            guard CLLocationManager.locationServicesEnabled() else {
                call.reject("Location Services are off. Enable them in iPhone Settings to record a ride.", "LOCATION_PERMISSION")
                return
            }
            pendingCall = call
            pendingAction = action
            switch manager.authorizationStatus {
            case .notDetermined: manager.requestWhenInUseAuthorization()
            default: finishPermissionRequest()
            }
        } catch {
            call.reject(error.localizedDescription, "RIDE_STORAGE", error)
        }
    }

    private func finishPermissionRequest() {
        guard let call = pendingCall, let action = pendingAction, let manager = manager else { return }
        if manager.authorizationStatus == .notDetermined { return }
        if (manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways),
           UIApplication.shared.applicationState != .active { return }
        pendingCall = nil
        pendingAction = nil
        guard manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways else {
            call.reject("Location access is required while recording. Allow location in iPhone Settings; no ride has started.", "LOCATION_PERMISSION")
            return
        }
        guard manager.accuracyAuthorization == .fullAccuracy else {
            call.reject("Precise Location is required to preserve street turns. Enable Precise Location for Ride Garage in iPhone Settings, then try again.", "LOCATION_PRECISE_REQUIRED")
            return
        }
        guard UIApplication.shared.applicationState == .active else {
            call.reject("Return to the app and press Start or Resume to begin recording.", "FOREGROUND_REQUIRED")
            return
        }
        mutate(call) {
            guard let journal = self.journal else { throw RideJournalError.storageUnavailable }
            switch action {
            case .start(let name, let country): try journal.start(name: name, country: country, at: self.now())
            case .resume: try journal.resume(at: self.now())
            }
            manager.allowsBackgroundLocationUpdates = true
            manager.startUpdatingLocation()
        }
    }

    @objc public func pause(_ call: CAPPluginCall) {
        onMain { [weak self] in
            guard let self = self else { return }
            self.cancelPendingAction()
            self.mutate(call) {
                guard self.journal?.session?.status == .recording else {
                    throw RideJournalError.invalidState("Only a recording ride can be paused.")
                }
                self.stopLocation()
                try self.journal?.pause(at: self.now())
            }
        }
    }

    @objc public func stop(_ call: CAPPluginCall) {
        onMain { [weak self] in
            guard let self = self else { return }
            self.cancelPendingAction()
            self.stopLocation()
            self.mutate(call) { try self.journal?.stop(at: self.now()) }
        }
    }

    @objc public func getSession(_ call: CAPPluginCall) {
        onMain { [weak self] in
            guard let self = self else { return }
            do {
                try self.prepare()
                self.checkRecordingAuthorization()
                call.resolve(self.payload())
            } catch { call.reject(error.localizedDescription, "RIDE_STORAGE", error) }
        }
    }

    @objc public func updateMetadata(_ call: CAPPluginCall) {
        onMain { [weak self] in
            guard let self = self else { return }
            self.mutate(call) {
                try self.journal?.updateMetadata(name: call.getString("name") ?? "Ride",
                                                country: call.getString("country") ?? "", at: self.now())
            }
        }
    }

    @objc public func acknowledge(_ call: CAPPluginCall) {
        onMain { [weak self] in
            guard let self = self else { return }
            self.mutate(call, returnsSession: false) {
                guard let id = call.getString("id") else {
                    throw RideJournalError.invalidState("The saved ride id is required.")
                }
                try self.journal?.acknowledge(id: id)
            }
        }
    }

    private func cancelPendingAction() {
        pendingCall?.reject("The recording request was cancelled.", "CANCELLED")
        pendingCall = nil
        pendingAction = nil
    }

    private func mutate(_ call: CAPPluginCall, returnsSession: Bool = true, _ operation: () throws -> Void) {
        do {
            try prepare()
            try operation()
            if returnsSession { call.resolve(payload()) }
            else { call.resolve() }
            notifyCurrent(force: true)
        } catch let error as RideJournalError {
            switch error {
            case .invalidState:
                call.reject(error.localizedDescription, "INVALID_STATE", error)
            default:
                storageFailed(error)
                call.reject(error.localizedDescription, "RIDE_STORAGE", error)
            }
        } catch {
            storageFailed(error)
            call.reject("Tracking stopped because the ride could not be saved locally. Free storage and reopen the app to recover the saved portion.",
                        "RIDE_STORAGE", error)
        }
    }

    private func stopLocation() {
        manager?.stopUpdatingLocation()
        manager?.allowsBackgroundLocationUpdates = false
    }

    private func storageFailed(_ error: Error) {
        stopLocation()
        journal?.failClosed(at: now(), reason: "Local storage failed. Tracking stopped. Reopen the app to recover the saved portion.")
        notifyCurrent(force: true)
    }

    private func interrupt(_ reason: String) {
        stopLocation()
        do { try journal?.interrupt(at: now(), reason: reason) }
        catch { journal?.failClosed(at: now(), reason: reason + " Local storage also failed.") }
        notifyCurrent(force: true)
    }

    private func checkRecordingAuthorization() {
        guard journal?.session?.status == .recording, let manager = manager else { return }
        guard manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways else {
            interrupt("Location access was removed. Tracking stopped. Restore access in Settings, then Resume.")
            return
        }
        if manager.accuracyAuthorization != .fullAccuracy {
            interrupt("Precise Location was turned off. Tracking stopped. Enable Precise Location in Settings, then Resume.")
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        finishPermissionRequest()
        checkRecordingAuthorization()
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard journal?.session?.status == .recording else { return }
        checkRecordingAuthorization()
        guard journal?.session?.status == .recording else { return }
        do {
            for location in locations.sorted(by: { $0.timestamp < $1.timestamp }) {
                guard CLLocationCoordinate2DIsValid(location.coordinate) else { continue }
                let speed = location.speed.isFinite && location.speed >= 0 ? location.speed : nil
                let point = RidePoint(latitude: location.coordinate.latitude, longitude: location.coordinate.longitude,
                                      timestamp: location.timestamp.timeIntervalSince1970 * 1_000,
                                      accuracy: location.horizontalAccuracy, speed: speed, segment: 0)
                try journal?.append(point, receivedAt: now())
            }
            notifyCurrent()
        } catch { storageFailed(error) }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard journal?.session?.status == .recording else { return }
        if let locationError = error as? CLError, locationError.code == .locationUnknown { return }
        interrupt("GPS recording was interrupted: " + error.localizedDescription + " Resume when location is available.")
    }

    public func locationManagerDidPauseLocationUpdates(_ manager: CLLocationManager) {
        if journal?.session?.status == .recording {
            interrupt("iOS paused location delivery. Open the app and Resume to continue recording.")
        }
    }

    private func payload() -> JSObject {
        guard let session = journal?.snapshot(at: now()) else { return ["session": NSNull()] }
        let points: [JSObject] = session.points.map { point in
            var value: JSObject = [
                "latitude": point.latitude, "longitude": point.longitude,
                "timestamp": point.timestamp, "accuracy": point.accuracy, "segment": point.segment
            ]
            if let speed = point.speed { value["speed"] = speed } else { value["speed"] = NSNull() }
            return value
        }
        var value: JSObject = [
            "id": session.id, "name": session.name, "country": session.country,
            "startedAt": session.startedAt, "status": session.status.rawValue,
            "points": points, "durationMs": session.durationMs
        ]
        if let endedAt = session.endedAt { value["endedAt"] = endedAt }
        if let error = session.lastError { value["lastError"] = error }
        return ["session": value]
    }

    private func notifyCurrent(force: Bool = false) {
        guard UIApplication.shared.applicationState == .active else { return }
        let timestamp = now()
        guard force || timestamp - lastNotificationAt >= 1_000 else { return }
        lastNotificationAt = timestamp
        notifyListeners("sessionChanged", data: payload())
    }
}
