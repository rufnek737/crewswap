import Foundation
import Capacitor
import StoreKit

@objc(StoreKitBridgePlugin)
public class StoreKitBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreKitBridgePlugin"
    public let jsName = "StoreKitBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getProduct", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getProducts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getEnvironment", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentEntitlement", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finish", returnType: CAPPluginReturnPromise)
    ]

    private let productID = "com.rufnekcrewswap.pro.lifetime"

    // 급구 쿠폰(소모형)도 같은 다리를 쓴다. 상품을 지정하지 않으면 종전처럼 PRO다.
    private let couponProductIDs = [
        "com.rufnekcrewswap.coupon.urgent5"
    ]

    private func requestedProductID(_ call: CAPPluginCall) -> String? {
        guard let requested = call.getString("productId") else { return productID }
        guard requested == productID || couponProductIDs.contains(requested) else { return nil }
        return requested
    }

    private func productInfo(_ product: Product) -> [String: Any] {
        [
            "productId": product.id,
            "displayName": product.displayName,
            "description": product.description,
            "displayPrice": product.displayPrice
        ]
    }

    private func storeEnvironment() -> String {
#if DEBUG
        return "sandbox"
#else
        return Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt" ? "sandbox" : "production"
#endif
    }

    @objc func getEnvironment(_ call: CAPPluginCall) {
        call.resolve(["environment": storeEnvironment()])
    }

    @objc func getProduct(_ call: CAPPluginCall) {
        guard let wanted = requestedProductID(call) else {
            call.reject("알 수 없는 상품입니다.", "PRODUCT_MISMATCH")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [wanted]).first else {
                    call.reject("App Store에서 상품을 찾을 수 없습니다.", "PRODUCT_NOT_FOUND")
                    return
                }
                call.resolve(productInfo(product))
            } catch {
                call.reject("상품 정보를 불러오지 못했습니다.", "PRODUCT_LOAD_FAILED", error)
            }
        }
    }

    // 쿠폰 묶음은 값을 비교해 고르는 화면이라 한 번에 받아온다.
    @objc func getProducts(_ call: CAPPluginCall) {
        let wanted = call.getArray("productIds", String.self) ?? couponProductIDs
        let allowed = wanted.filter { $0 == productID || couponProductIDs.contains($0) }
        Task {
            do {
                let products = try await Product.products(for: allowed)
                let ordered = allowed.compactMap { id in products.first { $0.id == id } }
                call.resolve(["products": ordered.map(productInfo)])
            } catch {
                call.reject("상품 정보를 불러오지 못했습니다.", "PRODUCT_LOAD_FAILED", error)
            }
        }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        guard let wanted = requestedProductID(call) else {
            call.reject("알 수 없는 상품입니다.", "PRODUCT_MISMATCH")
            return
        }
        Task {
            do {
                guard let product = try await Product.products(for: [wanted]).first else {
                    call.reject("App Store에서 상품을 찾을 수 없습니다.", "PRODUCT_NOT_FOUND")
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    resolveVerified(verification, expected: wanted, call: call)
                case .pending:
                    call.resolve(["status": "pending"])
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                @unknown default:
                    call.reject("알 수 없는 구매 상태입니다.", "UNKNOWN_PURCHASE_STATE")
                }
            } catch {
                call.reject("구매를 완료하지 못했습니다.", "PURCHASE_FAILED", error)
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
                await resolveCurrentEntitlement(call)
            } catch {
                call.reject("구매 내역을 복원하지 못했습니다.", "RESTORE_FAILED", error)
            }
        }
    }

    @objc func currentEntitlement(_ call: CAPPluginCall) {
        Task { await resolveCurrentEntitlement(call) }
    }

    @objc func finish(_ call: CAPPluginCall) {
        guard let requestedID = call.getString("transactionId") else {
            call.reject("거래 번호가 없습니다.", "TRANSACTION_ID_REQUIRED")
            return
        }
        Task {
            for await verification in Transaction.unfinished {
                if case .verified(let transaction) = verification,
                   String(transaction.id) == requestedID {
                    await transaction.finish()
                    call.resolve(["finished": true])
                    return
                }
            }
            call.resolve(["finished": false])
        }
    }

    private func resolveCurrentEntitlement(_ call: CAPPluginCall) async {
        for await verification in Transaction.currentEntitlements {
            if case .verified(let transaction) = verification,
               transaction.productID == productID {
                resolveVerified(verification, expected: productID, call: call)
                return
            }
        }
        call.resolve(["status": "notPurchased"])
    }

    private func resolveVerified(_ verification: VerificationResult<Transaction>, expected: String, call: CAPPluginCall) {
        switch verification {
        case .verified(let transaction):
            guard transaction.productID == expected else {
                call.reject("구매 상품이 일치하지 않습니다.", "PRODUCT_MISMATCH")
                return
            }
            call.resolve([
                "status": "verified",
                "productId": transaction.productID,
                "transactionId": String(transaction.id),
                "originalTransactionId": String(transaction.originalID),
                "signedTransaction": verification.jwsRepresentation,
                "environment": storeEnvironment()
            ])
        case .unverified(_, let error):
            call.reject("App Store 거래를 확인할 수 없습니다.", "UNVERIFIED_TRANSACTION", error)
        }
    }
}
