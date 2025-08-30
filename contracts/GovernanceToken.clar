;; GovernanceToken.clar
;; A SIP-010 compliant fungible token for the CrossManu Alliance, used for governance, incentives, and staking.
;; Features: Minting rewards for contributions, staking for voting power, proposal creation and voting, execution of passed proposals.
;; Sophisticated governance with quadratic voting option, proposal thresholds, and reward distribution.

;; Constants
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-PAUSED u101)
(define-constant ERR-INVALID-AMOUNT u102)
(define-constant ERR-INVALID-RECIPIENT u103)
(define-constant ERR-INVALID-PROPOSAL u104)
(define-constant ERR-ALREADY-VOTED u105)
(define-constant ERR-PROPOSAL-ENDED u106)
(define-constant ERR-NOT-ENOUGH-VOTES u107)
(define-constant ERR-INVALID-STAKE u108)
(define-constant ERR-STAKE-LOCKED u109)
(define-constant ERR-NO-REWARDS u110)
(define-constant ERR-PROPOSAL-ACTIVE u111)
(define-constant ERR-MAX-PROPOSALS-REACHED u112)
(define-constant ERR-INVALID-VOTE-TYPE u113)

(define-constant CONTRACT-OWNER tx-sender)
(define-constant TOKEN-NAME "CrossManuAllianceToken")
(define-constant TOKEN-SYMBOL "CMAT")
(define-constant TOKEN-DECIMALS u6)
(define-constant INITIAL-SUPPLY u1000000000000) ;; 1 million tokens with 6 decimals
(define-constant PROPOSAL-QUORUM u10) ;; 10% of total supply needed for quorum
(define-constant PROPOSAL-DURATION u1440) ;; ~10 days (144 blocks/day)
(define-constant STAKE-LOCK-PERIOD u144) ;; ~1 day
(define-constant MAX-PROPOSALS u100)
(define-constant VOTE-LINEAR u1)
(define-constant VOTE-QUADRATIC u2)

;; Fungible Token
(define-fungible-token cmat u18446744073709551615) ;; Max u64

;; Data Maps
(define-map balances principal uint)
(define-map allowances { owner: principal, spender: principal } uint)
(define-map minters principal bool)
(define-map proposals uint {
    creator: principal,
    description: (string-utf8 500),
    start-height: uint,
    end-height: uint,
    yes-votes: uint,
    no-votes: uint,
    executed: bool,
    vote-type: uint ;; 1: linear, 2: quadratic
})
(define-map votes { proposal-id: uint, voter: principal } { yes: bool, amount: uint })
(define-map stakes principal { amount: uint, lock-until: uint })
(define-map rewards principal uint)
(define-map proposal-count uint) ;; Global counter for proposal IDs

;; Variables
(define-data-var total-supply uint u0)
(define-data-var paused bool false)
(define-data-var admin principal tx-sender)
(define-data-var next-proposal-id uint u1)
(define-data-var reward-pool uint u0)

;; SIP-010 Functions

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
    (begin
        (asserts! (not (var-get paused)) (err ERR-PAUSED))
        (asserts! (is-eq tx-sender sender) (err ERR-UNAUTHORIZED))
        (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
        (asserts! (not (is-eq recipient 'SP000000000000000000002Q6VF78)) (err ERR-INVALID-RECIPIENT)) ;; Example invalid
        (try! (ft-transfer? cmat amount sender recipient))
        (ok true)
    )
)

(define-read-only (get-name)
    (ok TOKEN-NAME)
)

(define-read-only (get-symbol)
    (ok TOKEN-SYMBOL)
)

(define-read-only (get-decimals)
    (ok TOKEN-DECIMALS)
)

(define-read-only (get-balance (account principal))
    (ok (ft-get-balance cmat account))
)

(define-read-only (get-total-supply)
    (ok (var-get total-supply))
)

(define-read-only (get-token-uri)
    (ok (some "https://crossmanu-alliance.com/cmat.json"))
)

;; Admin Functions

(define-public (set-admin (new-admin principal))
    (begin
        (asserts! (is-eq tx-sender (var-get admin)) (err ERR-UNAUTHORIZED))
        (var-set admin new-admin)
        (ok true)
    )
)

(define-public (pause)
    (begin
        (asserts! (is-eq tx-sender (var-get admin)) (err ERR-UNAUTHORIZED))
        (var-set paused true)
        (ok true)
    )
)

(define-public (unpause)
    (begin
        (asserts! (is-eq tx-sender (var-get admin)) (err ERR-UNAUTHORIZED))
        (var-set paused false)
        (ok true)
    )
)

(define-public (add-minter (minter principal))
    (begin
        (asserts! (is-eq tx-sender (var-get admin)) (err ERR-UNAUTHORIZED))
        (map-set minters minter true)
        (ok true)
    )
)

(define-public (remove-minter (minter principal))
    (begin
        (asserts! (is-eq tx-sender (var-get admin)) (err ERR-UNAUTHORIZED))
        (map-set minters minter false)
        (ok true)
    )
)

;; Minting for Rewards
(define-public (mint (amount uint) (recipient principal))
    (begin
        (asserts! (not (var-get paused)) (err ERR-PAUSED))
        (asserts! (unwrap-panic (map-get? minters tx-sender)) (err ERR-UNAUTHORIZED))
        (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
        (try! (ft-mint? cmat amount recipient))
        (var-set total-supply (+ (var-get total-supply) amount))
        (ok true)
    )
)

;; Staking
(define-public (stake-tokens (amount uint))
    (let ((current-stake (default-to { amount: u0, lock-until: u0 } (map-get? stakes tx-sender))))
        (asserts! (not (var-get paused)) (err ERR-PAUSED))
        (asserts! (> amount u0) (err ERR-INVALID-STAKE))
        (try! (ft-transfer? cmat amount tx-sender (as-contract tx-sender)))
        (map-set stakes tx-sender { amount: (+ (get amount current-stake) amount), lock-until: (+ block-height STAKE-LOCK-PERIOD) })
        (ok true)
    )
)

(define-public (unstake-tokens (amount uint))
    (let ((current-stake (unwrap-panic (map-get? stakes tx-sender))))
        (asserts! (not (var-get paused)) (err ERR-PAUSED))
        (asserts! (>= (get amount current-stake) amount) (err ERR-INVALID-STAKE))
        (asserts! (>= block-height (get lock-until current-stake)) (err ERR-STAKE-LOCKED))
        (try! (as-contract (ft-transfer? cmat amount tx-sender tx-sender)))
        (map-set stakes tx-sender { amount: (- (get amount current-stake) amount), lock-until: (get lock-until current-stake) })
        (ok true)
    )
)

(define-read-only (get-stake (account principal))
    (map-get? stakes account)
)

;; Governance

(define-public (create-proposal (description (string-utf8 500)) (vote-type uint))
    (let ((proposal-id (var-get next-proposal-id)))
        (asserts! (not (var-get paused)) (err ERR-PAUSED))
        (asserts! (<= proposal-id MAX-PROPOSALS) (err ERR-MAX-PROPOSALS-REACHED))
        (asserts! (or (is-eq vote-type VOTE-LINEAR) (is-eq vote-type VOTE-QUADRATIC)) (err ERR-INVALID-VOTE-TYPE))
        (asserts! (>= (ft-get-balance cmat tx-sender) u1000000) (err ERR-UNAUTHORIZED)) ;; Minimum balance to propose
        (map-set proposals proposal-id {
            creator: tx-sender,
            description: description,
            start-height: block-height,
            end-height: (+ block-height PROPOSAL-DURATION),
            yes-votes: u0,
            no-votes: u0,
            executed: false,
            vote-type: vote-type
        })
        (var-set next-proposal-id (+ proposal-id u1))
        (ok proposal-id)
    )
)

(define-public (vote-proposal (proposal-id uint) (yes bool) (amount uint))
    (let (
        (proposal (unwrap-panic (map-get? proposals proposal-id)))
        (stake (unwrap-panic (map-get? stakes tx-sender)))
        (vote-weight (if (is-eq (get vote-type proposal) VOTE-QUADRATIC)
                         (unwrap-panic (to-uint (sqrt (to-float amount)))) ;; Approximate quadratic
                         amount))
    )
        (asserts! (not (var-get paused)) (err ERR-PAUSED))
        (asserts! (< block-height (get end-height proposal)) (err ERR-PROPOSAL-ENDED))
        (asserts! (is-none (map-get? votes { proposal-id: proposal-id, voter: tx-sender })) (err ERR-ALREADY-VOTED))
        (asserts! (<= amount (get amount stake)) (err ERR-INVALID-AMOUNT))
        (map-set votes { proposal-id: proposal-id, voter: tx-sender } { yes: yes, amount: vote-weight })
        (if yes
            (map-set proposals proposal-id (merge proposal { yes-votes: (+ (get yes-votes proposal) vote-weight) }))
            (map-set proposals proposal-id (merge proposal { no-votes: (+ (get no-votes proposal) vote-weight) }))
        )
        (ok true)
    )
)

(define-public (end-proposal (proposal-id uint))
    (let ((proposal (unwrap-panic (map-get? proposals proposal-id))))
        (asserts! (>= block-height (get end-height proposal)) (err ERR-PROPOSAL-ACTIVE))
        (asserts! (not (get executed proposal)) (err ERR-ALREADY-VOTED)) ;; Reuse error
        (if (and (> (get yes-votes proposal) (get no-votes proposal))
                 (>= (+ (get yes-votes proposal) (get no-votes proposal)) (* (var-get total-supply) PROPOSAL-QUORUM / u100)))
            (begin
                ;; Execute: For demo, just mark executed. In full, call other contracts.
                (map-set proposals proposal-id (merge proposal { executed: true }))
                (ok true)
            )
            (err ERR-NOT-ENOUGH-VOTES)
        )
    )
)

(define-read-only (get-proposal (proposal-id uint))
    (map-get? proposals proposal-id)
)

(define-read-only (get-vote (proposal-id uint) (voter principal))
    (map-get? votes { proposal-id: proposal-id, voter: voter })
)

;; Rewards
(define-public (distribute-rewards (amount uint))
    (begin
        (asserts! (is-eq tx-sender (var-get admin)) (err ERR-UNAUTHORIZED))
        (var-set reward-pool (+ (var-get reward-pool) amount))
        (ok true)
    )
)

(define-public (claim-rewards)
    (let ((claimant tx-sender) (pending (default-to u0 (map-get? rewards claimant))))
        (asserts! (> pending u0) (err ERR-NO-REWARDS))
        (try! (as-contract (ft-transfer? cmat pending tx-sender claimant)))
        (map-delete rewards claimant)
        (ok pending)
    )
)

;; Internal helper for sqrt approximation (simple integer sqrt)
(define-private (sqrt (x uint))
    (let ((z (/ (+ x u1) u2)))
        (while (> (/ x z) z) (set z (/ (+ (/ x z) z) u2)))
        z
    )
)

;; Initial Mint
(begin
    (try! (ft-mint? cmat INITIAL-SUPPLY CONTRACT-OWNER))
    (var-set total-supply INITIAL-SUPPLY)
)