import Foundation
import Capacitor
import os

// Native memory sampler for the diagnostics log (JS side: src/memory-probe.ts).
//
// The failure mode under investigation is the WKWebView *WebContent* process
// being killed at its private WebKit memory limit (~2GB observed in jetsam
// forensics, see docs/death-clip-webcontent-kill-handover.md). That process
// cannot be inspected from here — no task port, no public API — and WebKit
// exposes no performance.memory to JS. So the probe reports two proxies:
//
//  - host-wide memory statistics, where WebContent growth shows up as falling
//    free/inactive pages and a rising compressor;
//  - the app process's own footprint and jetsam headroom, which is the control
//    line proving whether the native shell participates in the growth (the
//    jetsam log had it at 12 MB while WebContent held 1,978 MB).
@objc(MemoryProbePlugin)
public class MemoryProbePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MemoryProbePlugin"
    public let jsName = "MemoryProbe"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sample", returnType: CAPPluginReturnPromise)
    ]

    @objc func sample(_ call: CAPPluginCall) {
        var result: [String: Any] = [
            "appAvailableBytes": Int(os_proc_available_memory())
        ]

        var vmInfo = task_vm_info_data_t()
        var vmCount = mach_msg_type_number_t(
            MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let vmResult = withUnsafeMutablePointer(to: &vmInfo) { infoPtr in
            infoPtr.withMemoryRebound(to: integer_t.self, capacity: Int(vmCount)) { intPtr in
                task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), intPtr, &vmCount)
            }
        }
        if vmResult == KERN_SUCCESS {
            result["appFootprintBytes"] = Int(vmInfo.phys_footprint)
        }

        var hostInfo = vm_statistics64_data_t()
        var hostCount = mach_msg_type_number_t(
            MemoryLayout<vm_statistics64_data_t>.size / MemoryLayout<integer_t>.size)
        let hostResult = withUnsafeMutablePointer(to: &hostInfo) { infoPtr in
            infoPtr.withMemoryRebound(to: integer_t.self, capacity: Int(hostCount)) { intPtr in
                host_statistics64(mach_host_self(), host_flavor_t(HOST_VM_INFO64), intPtr, &hostCount)
            }
        }
        if hostResult == KERN_SUCCESS {
            let pageSize = Int(vm_kernel_page_size)
            result["hostFreeBytes"] = Int(hostInfo.free_count) * pageSize
            result["hostInactiveBytes"] = Int(hostInfo.inactive_count) * pageSize
            result["hostCompressedBytes"] = Int(hostInfo.compressor_page_count) * pageSize
        }

        call.resolve(result)
    }
}
