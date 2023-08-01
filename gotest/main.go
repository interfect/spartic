package main

import (
    "context"
    "fmt"
    "os"
    "os/signal"
    "strings"
    "syscall"
    "github.com/libp2p/go-libp2p"
    "github.com/libp2p/go-libp2p/core/crypto"
    "github.com/libp2p/go-libp2p/core/host"
    "github.com/libp2p/go-libp2p/core/peer"
    "github.com/libp2p/go-libp2p/core/peerstore"
    "github.com/libp2p/go-libp2p/p2p/host/routed"
    "github.com/libp2p/go-libp2p/p2p/protocol/ping"
    dht "github.com/libp2p/go-libp2p-kad-dht"
    multiaddr "github.com/multiformats/go-multiaddr"
    "github.com/ipfs/go-ds-leveldb"
    ds "github.com/ipfs/go-datastore"
)

/// Load a private key from the given datastore, or make a new one and store it in there.
func loadOrMakeKey(ctx context.Context, store ds.Datastore) (crypto.PrivKey, error) {
    identityKey := ds.NewKey("gotest/PrivKey")
    identityData, err := store.Get(ctx, identityKey)
    if err == ds.ErrNotFound {
        // Make a new keypair. We only actually need the privkey
        privKey, _, err := crypto.GenerateKeyPair(crypto.Ed25519, -1)
        if err != nil {
            return nil, fmt.Errorf("could not generate keypair: %w", err)
        }
        // Turn it into bytes, and store in existing variable
        identityData, err = crypto.MarshalPrivateKey(privKey)
        if err != nil {
            return nil, fmt.Errorf("could not serialize new private key: %w", err)
        }
        // Save the bytes back to the database
        err = store.Put(ctx, identityKey, identityData)
        if err != nil {
            return nil, fmt.Errorf("could not save private key keypair: %w", err)
        }
    } else if err != nil {
        return nil, fmt.Errorf("could not read private key: %w", err)
    }
    // Now identityData is always set
    privKey, err := crypto.UnmarshalPrivateKey(identityData)
    if err != nil {
        return nil, fmt.Errorf("could not decode stored private key keypair: %w", err)
    }
    
    return privKey, nil
}

/// Make a libp2p host with all the cool features we want.
/// Loads key from the given data store, and uses it for the DHT.
/// Registers with bootstrap peers under our peer ID.
func makeNode(ctx context.Context, store ds.Batching) (host.Host, *dht.IpfsDHT, error) {
    // Load our key
    privKey, err := loadOrMakeKey(ctx, store)
    if err != nil {
        return nil, nil, fmt.Errorf("could not load or make key: %w", err)
    }

    // Start a libp2p node with that key
    baseNode, err := libp2p.New(
        libp2p.Identity(privKey),
        libp2p.NATPortMap(),
    )
    if err != nil {
        return nil, nil, fmt.Errorf("could not make base node: %w", err)
    }
    
    // Make a DHT around the node
    dhtInstance, err := dht.New(ctx, baseNode,
        // Bootstrap with the default peers
        dht.BootstrapPeersFunc(dht.GetDefaultBootstrapPeerAddrInfos),
        dht.Datastore(store),

    )
    if err != nil {
        return nil, nil, fmt.Errorf("could not make DHT: %w", err)
    }
    
    // And use it to make a routed node
    node := routedhost.Wrap(baseNode, dhtInstance)
    
    // Manually bootstrap
    // We *must* connect to several real nodes or the DHT will just immediately fail to come up.
    for _, bootstrapAddr := range dht.GetDefaultBootstrapPeerAddrInfos() {
        node.Peerstore().AddAddrs(bootstrapAddr.ID, bootstrapAddr.Addrs, peerstore.PermanentAddrTTL)
        if err := node.Connect(ctx, bootstrapAddr); err != nil {
            fmt.Println("Failed to dial bootstrap peer", bootstrapAddr)
        } else {
            fmt.Println("Connected to bootstrap peer", bootstrapAddr)
        }
    }

    // Bootstrap the DHT
    err = dhtInstance.Bootstrap(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("could not bootstrap DHT: %w", err)
	}
    
    return node, dhtInstance, nil
}

func parsePeer(target string) (*peer.AddrInfo, error) {

    if strings.HasPrefix(target, "/") {
        // Probably a multiaddr
        addr, err := multiaddr.NewMultiaddr(target)
        if err != nil {
            return nil, fmt.Errorf("could not parse multiaddr: %w", err)
        }
        peerInfo, err := peer.AddrInfoFromP2pAddr(addr)
        if err != nil {
            return nil, fmt.Errorf("could not get peer info from multiaddr: %w", err)
        }
        
        return peerInfo, nil
    } else {
        // Probably a bare peer ID
        peerID, err := peer.Decode(target)
        if err != nil {
            panic(err)
        }
        
        return &peer.AddrInfo{peerID, nil}, nil
    }
}

func main() {

    ctx := context.Background()

    if len(os.Args) < 2 {
        panic("Please specify a database argument")
    }

    // Connect to our data stroe that holds stuff like our node keys.
    // We assume it is thread-safe and doesn't need wrapping
    store, err := leveldb.NewDatastore(os.Args[1], &leveldb.Options{})
    if err != nil {
        panic(err)
    }
    
    // Load up keys from the datastore and make the node
    node, dht, err := makeNode(ctx, store)
    if err != nil {
        panic(err)
    }
    
    // print the node's PeerInfo in multiaddr format
    peerInfo := peer.AddrInfo{
        ID:    node.ID(),
        Addrs: node.Addrs(),
    }
    
    addrs, err := peer.AddrInfoToP2pAddrs(&peerInfo)
    if err != nil {
        panic(err)
    }
    
    for _, addr := range addrs {
        fmt.Println("libp2p node address:", addr)
    }

    // if a remote peer has been passed on the command line, connect to it
    // and send it 5 ping messages, otherwise wait for a signal to stop
    if len(os.Args) > 2 {
        target := os.Args[2]
        
        // Work out who we are meant to connect to
        remotePeerInfo, err := parsePeer(target)
        if err != nil {
            panic(err)
        }
        
        if len(remotePeerInfo.Addrs) > 0 {
            fmt.Println("Connecting directly to", target)
            if err := node.Connect(ctx, *remotePeerInfo); err != nil {
                // If we have addresses we can make a direct connection right off.
                fmt.Println("Could not connect:", err, "Continuing anyway.")
            }
        } else {
            fmt.Println("Searching for", target)
            found, err := dht.FindPeer(ctx, remotePeerInfo.ID)
            if err != nil {
                fmt.Println("Could not find peer:", err, "Continuing anyway.")
            } else {
                remotePeerInfo = &found
                if len(remotePeerInfo.Addrs) == 0 {
                    fmt.Println("Found no addresses for", target)
                }
                for _, addr := range remotePeerInfo.Addrs {
                    fmt.Println("Found address:", addr)
                }
                if err := node.Connect(ctx, *remotePeerInfo); err != nil {
                    // Try connecting after the lookup
                    fmt.Println("Could not connect:", err, "Continuing anyway.")
                }
            }
        }
        
        fmt.Println("sending 5 ping messages to", remotePeerInfo.ID)
        pingService := &ping.PingService{Host: node}
        ch := pingService.Ping(ctx, remotePeerInfo.ID)
        for i := 0; i < 5; i++ {
            res := <-ch
            if res.Error != nil {
                fmt.Println("got ping error!", "Error:", res.Error)
            } else {
                fmt.Println("got ping response!", "RTT:", res.RTT)
            }
        }
    } else {
        // wait for a SIGINT or SIGTERM signal
        ch := make(chan os.Signal, 1)
        signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
        <-ch
        fmt.Println("Received signal, shutting down...")
    }

    // shut the node down
    if err := node.Close(); err != nil {
            panic(err)
    }
}
