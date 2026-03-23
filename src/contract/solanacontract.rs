use anchor_lang::prelude::*;
use anchor_spl::token::Burn;
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::{
        mpl_token_metadata::{
            instructions::{CreateMetadataAccountV3CpiBuilder, UpdateMetadataAccountV2CpiBuilder},
            types::DataV2,
        },
        Metadata, MetadataAccount,
    },
    token::{self, Mint, MintTo, Token, TokenAccount, Transfer},
};

declare_id!("Ec6UcWBULj7j2TTapJNyhffzS5bbNy2F95E6w1g4ykqv");

#[program]
pub mod fungible_token_factory {
    use super::*;

    pub fn initialize_bridge(ctx: Context<InitializeBridge>) -> Result<()> {
        let config = &mut ctx.accounts.bridge_config;
        config.primary_owner = ctx.accounts.owner.key();
        config.owners = vec![ctx.accounts.owner.key()];
        config.managers = vec![];
        config.bump = ctx.bumps.bridge_config;
        Ok(())
    }

    // ── Manager management (primary_owner only) ──────────────

    pub fn add_manager(ctx: Context<ModifyManagers>, new_manager: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.bridge_config;
        require!(
            config.primary_owner == ctx.accounts.caller.key(),
            ErrorCode::Unauthorized
        );
        require!(
            !config.managers.contains(&new_manager),
            ErrorCode::AlreadyAManager
        );
        require!(
            !config.owners.contains(&new_manager),
            ErrorCode::AlreadyAnOwner
        );
        require!(
            config.managers.len() < 20,
            ErrorCode::TooManyManagers
        );
        config.managers.push(new_manager);
        Ok(())
    }

    pub fn remove_manager(ctx: Context<ModifyManagers>, manager: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.bridge_config;
        require!(
            config.primary_owner == ctx.accounts.caller.key(),
            ErrorCode::Unauthorized
        );
        let pos = config.managers.iter().position(|k| *k == manager)
            .ok_or(ErrorCode::ManagerNotFound)?;
        config.managers.remove(pos);
        Ok(())
    }

    // ── Owner management (unchanged) ─────────────────────────

    pub fn add_bridge_owner(ctx: Context<ModifyBridgeOwners>, new_owner: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.bridge_config;
        require!(
            config.owners.contains(&ctx.accounts.caller.key()),
            ErrorCode::Unauthorized
        );
        require!(
            !config.owners.contains(&new_owner),
            ErrorCode::AlreadyAnOwner
        );
        require!(
            config.owners.len() < 10,
            ErrorCode::TooManyOwners
        );
        config.owners.push(new_owner);
        Ok(())
    }

    pub fn remove_bridge_owner(ctx: Context<ModifyBridgeOwners>, remove_owner: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.bridge_config;
        require!(
            config.primary_owner == ctx.accounts.caller.key(),
            ErrorCode::Unauthorized
        );
        require!(
            remove_owner != config.primary_owner,
            ErrorCode::CannotRemovePrimaryOwner
        );
        let pos = config.owners.iter().position(|k| *k == remove_owner)
            .ok_or(ErrorCode::OwnerNotFound)?;
        config.owners.remove(pos);
        Ok(())
    }

    // ── Bridgeable token management (owner OR manager) ────────

    pub fn add_bridgeable_token(
        ctx: Context<AddBridgeableToken>,
        label: String,
    ) -> Result<()> {
        let config = &ctx.accounts.bridge_config;
        let caller = ctx.accounts.owner.key();
        require!(
            config.owners.contains(&caller) || config.managers.contains(&caller),
            ErrorCode::Unauthorized
        );
        require!(label.len() <= 64, ErrorCode::LabelTooLong);

        let entry = &mut ctx.accounts.bridgeable_token;
        entry.mint = ctx.accounts.mint.key();
        entry.label = label;
        entry.is_active = true;
        entry.bump = ctx.bumps.bridgeable_token;
        Ok(())
    }

    pub fn remove_bridgeable_token(ctx: Context<RemoveBridgeableToken>) -> Result<()> {
        let config = &ctx.accounts.bridge_config;
        let caller = ctx.accounts.owner.key();
        require!(
            config.owners.contains(&caller) || config.managers.contains(&caller),
            ErrorCode::Unauthorized
        );
        ctx.accounts.bridgeable_token.is_active = false;
        Ok(())
    }

    pub fn reactivate_bridgeable_token(ctx: Context<ReactivateBridgeableToken>) -> Result<()> {
        let config = &ctx.accounts.bridge_config;
        let caller = ctx.accounts.owner.key();
        require!(
            config.owners.contains(&caller) || config.managers.contains(&caller),
            ErrorCode::Unauthorized
        );
        ctx.accounts.bridgeable_token.is_active = true;
        Ok(())
    }

    // ── Token creation / minting (unchanged) ─────────────────

    pub fn create_token_with_metadata(
        ctx: Context<CreateTokenWithMetadata>,
        name: String,
        symbol: String,
        uri: String,
        decimals: u8,
        seller_fee_basis_points: u16,
    ) -> Result<()> {
        require!(name.len() <= 32, ErrorCode::NameTooLong);
        require!(symbol.len() <= 10, ErrorCode::SymbolTooLong);
        require!(uri.len() <= 200, ErrorCode::UriTooLong);

        let token_info = &mut ctx.accounts.token_info;
        token_info.creator = ctx.accounts.creator.key();
        token_info.mint = ctx.accounts.mint.key();
        token_info.name = name.clone();
        token_info.symbol = symbol.clone();
        token_info.uri = uri.clone();
        token_info.decimals = decimals;
        token_info.total_minted = 0;
        token_info.is_active = true;
        token_info.bump = ctx.bumps.token_info;

        let data_v2 = DataV2 {
            name: name.clone(),
            symbol: symbol.clone(),
            uri: uri.clone(),
            seller_fee_basis_points,
            creators: None,
            collection: None,
            uses: None,
        };

        CreateMetadataAccountV3CpiBuilder::new(&ctx.accounts.metadata_program.to_account_info())
            .metadata(&ctx.accounts.metadata_account.to_account_info())
            .mint(&ctx.accounts.mint.to_account_info())
            .mint_authority(&ctx.accounts.token_info.to_account_info())
            .payer(&ctx.accounts.creator.to_account_info())
            .update_authority(&ctx.accounts.creator.to_account_info(), true)
            .system_program(&ctx.accounts.system_program.to_account_info())
            .rent(Some(&ctx.accounts.rent.to_account_info()))
            .data(data_v2)
            .is_mutable(true)
            .invoke_signed(
                &[&[
                    b"token_info",
                    ctx.accounts.mint.key().as_ref(),
                    &[ctx.bumps.token_info],
                ]],
            )?;

        emit!(TokenCreatedEvent {
            mint: ctx.accounts.mint.key(),
            creator: ctx.accounts.creator.key(),
            name,
            symbol,
            decimals,
        });

        Ok(())
    }

    pub fn update_metadata(
        ctx: Context<UpdateMetadata>,
        name: Option<String>,
        symbol: Option<String>,
        uri: Option<String>,
        seller_fee_basis_points: Option<u16>,
    ) -> Result<()> {
        require!(
            ctx.accounts.token_info.creator == ctx.accounts.creator.key(),
            ErrorCode::Unauthorized
        );

        let md = &ctx.accounts.metadata_account;

        let data_v2 = DataV2 {
            name: name.as_ref().unwrap_or(&md.name).clone(),
            symbol: symbol.as_ref().unwrap_or(&md.symbol).clone(),
            uri: uri.as_ref().unwrap_or(&md.uri).clone(),
            seller_fee_basis_points: seller_fee_basis_points
                .unwrap_or(md.seller_fee_basis_points),
            creators: md.creators.clone(),
            collection: md.collection.clone(),
            uses: md.uses.clone(),
        };

        UpdateMetadataAccountV2CpiBuilder::new(
            &ctx.accounts.metadata_program.to_account_info(),
        )
        .metadata(&ctx.accounts.metadata_account.to_account_info())
        .update_authority(&ctx.accounts.creator.to_account_info())
        .data(data_v2)
        .primary_sale_happened(md.primary_sale_happened)
        .is_mutable(md.is_mutable)
        .invoke()?;

        if let Some(n) = name {
            ctx.accounts.token_info.name = n;
        }
        if let Some(s) = symbol {
            ctx.accounts.token_info.symbol = s;
        }
        if let Some(u) = uri {
            ctx.accounts.token_info.uri = u;
        }

        Ok(())
    }

    pub fn create_token(
        ctx: Context<CreateToken>,
        name: String,
        symbol: String,
        uri: String,
        decimals: u8,
    ) -> Result<()> {
        require!(name.len() <= 32, ErrorCode::NameTooLong);
        require!(symbol.len() <= 10, ErrorCode::SymbolTooLong);
        require!(uri.len() <= 200, ErrorCode::UriTooLong);

        let token_info = &mut ctx.accounts.token_info;
        token_info.creator = ctx.accounts.creator.key();
        token_info.mint = ctx.accounts.mint.key();
        token_info.name = name.clone();
        token_info.symbol = symbol.clone();
        token_info.uri = uri;
        token_info.decimals = decimals;
        token_info.total_minted = 0;
        token_info.is_active = true;
        token_info.bump = ctx.bumps.token_info;

        emit!(TokenCreatedEvent {
            mint: ctx.accounts.mint.key(),
            creator: ctx.accounts.creator.key(),
            name,
            symbol,
            decimals,
        });

        Ok(())
    }

    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        require!(ctx.accounts.token_info.is_active, ErrorCode::TokenInactive);
        require!(amount > 0, ErrorCode::InvalidAmount);

        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.accounts.token_info.bump;
        let seeds = &[b"token_info", mint_key.as_ref(), &[bump]];
        let signer = &[&seeds[..]];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.token_info.to_account_info(),
            },
            signer,
        );
        token::mint_to(cpi_ctx, amount)?;

        ctx.accounts.token_info.total_minted = ctx
            .accounts
            .token_info
            .total_minted
            .checked_add(amount)
            .ok_or(ErrorCode::Overflow)?;

        emit!(TokensMintedEvent {
            mint: ctx.accounts.mint.key(),
            minter: ctx.accounts.minter.key(),
            recipient: ctx.accounts.recipient.key(),
            amount,
        });

        Ok(())
    }

    pub fn batch_mint_tokens<'info>(
        ctx: Context<'_, '_, '_, 'info, BatchMintTokens<'info>>,
        amounts: Vec<u64>,
    ) -> Result<()> {
        require!(ctx.accounts.token_info.is_active, ErrorCode::TokenInactive);
        require!(!amounts.is_empty(), ErrorCode::EmptyBatch);
        require!(amounts.len() <= 10, ErrorCode::BatchTooLarge);
        for &a in &amounts {
            require!(a > 0, ErrorCode::InvalidAmount);
        }

        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.accounts.token_info.bump;
        let seeds = &[b"token_info", mint_key.as_ref(), &[bump]];
        let signer = &[&seeds[..]];

        let mut total: u64 = 0;
        for (i, &amt) in amounts.iter().enumerate() {
            let to = &ctx.remaining_accounts[i];
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: to.to_account_info(),
                    authority: ctx.accounts.token_info.to_account_info(),
                },
                signer,
            );
            token::mint_to(cpi_ctx, amt)?;
            total = total.checked_add(amt).ok_or(ErrorCode::Overflow)?;
        }

        ctx.accounts.token_info.total_minted = ctx
            .accounts
            .token_info
            .total_minted
            .checked_add(total)
            .ok_or(ErrorCode::Overflow)?;

        Ok(())
    }

    pub fn toggle_token_status(ctx: Context<ToggleTokenStatus>) -> Result<()> {
        require!(
            ctx.accounts.token_info.creator == ctx.accounts.creator.key(),
            ErrorCode::Unauthorized
        );
        ctx.accounts.token_info.is_active = !ctx.accounts.token_info.is_active;
        Ok(())
    }

    pub fn update_token_metadata(
        ctx: Context<UpdateTokenMetadata>,
        name: Option<String>,
        symbol: Option<String>,
        uri: Option<String>,
    ) -> Result<()> {
        require!(
            ctx.accounts.token_info.creator == ctx.accounts.creator.key(),
            ErrorCode::Unauthorized
        );

        if let Some(n) = name {
            require!(n.len() <= 32, ErrorCode::NameTooLong);
            ctx.accounts.token_info.name = n;
        }
        if let Some(s) = symbol {
            require!(s.len() <= 10, ErrorCode::SymbolTooLong);
            ctx.accounts.token_info.symbol = s;
        }
        if let Some(u) = uri {
            require!(u.len() <= 200, ErrorCode::UriTooLong);
            ctx.accounts.token_info.uri = u;
        }

        Ok(())
    }

    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.from_token_account.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        );
        token::burn(cpi_ctx, amount)?;

        ctx.accounts.token_info.total_minted = ctx
            .accounts
            .token_info
            .total_minted
            .checked_sub(amount)
            .ok_or(ErrorCode::Overflow)?;

        Ok(())
    }

    pub fn bridge_token(
        ctx: Context<BridgeToken>,
        amount: u64,
        receiver_on_sepolia: [u8; 20],
    ) -> Result<()> {
        require!(ctx.accounts.token_info.is_active, ErrorCode::TokenInactive);
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(
            ctx.accounts.bridgeable_token.is_active,
            ErrorCode::TokenNotBridgeable
        );

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        emit!(BridgeInitiatedEvent {
            sender: ctx.accounts.user.key(),
            mint: ctx.accounts.mint.key(),
            token_name: ctx.accounts.token_info.name.clone(),
            token_symbol: ctx.accounts.token_info.symbol.clone(),
            decimals: ctx.accounts.token_info.decimals,
            amount,
            receiver_on_sepolia,
            timestamp: Clock::get()?.unix_timestamp as u64,
        });

        Ok(())
    }

    pub fn return_token_to_user(
        ctx: Context<ReturnTokenToUser>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(
            ctx.accounts.bridge_config.owners.contains(&ctx.accounts.bridge_owner.key()),
            ErrorCode::Unauthorized
        );

        let mint_key = ctx.accounts.mint.key();
        let vault_seeds: &[&[u8]] = &[
            b"vault",
            mint_key.as_ref(),
            &[ctx.bumps.vault_authority],
        ];
        let signer = &[vault_seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer,
        );
        token::transfer(cpi_ctx, amount)?;

        emit!(TokensReturnedEvent {
            receiver: ctx.accounts.recipient.key(),
            mint: ctx.accounts.mint.key(),
            amount,
            timestamp: Clock::get()?.unix_timestamp as u64,
        });

        Ok(())
    }

    pub fn transfer_bridge_ownership(
        ctx: Context<TransferBridgeOwnership>,
        new_owner: Pubkey,
    ) -> Result<()> {
        require!(
            ctx.accounts.bridge_config.primary_owner == ctx.accounts.current_owner.key(),
            ErrorCode::Unauthorized
        );
        let config = &mut ctx.accounts.bridge_config;
        let old = config.primary_owner;
        if let Some(pos) = config.owners.iter().position(|k| *k == old) {
            config.owners.remove(pos);
        }
        if !config.owners.contains(&new_owner) {
            config.owners.push(new_owner);
        }
        config.primary_owner = new_owner;
        Ok(())
    }
}

/* ================================================================
   ACCOUNTS
   ================================================================ */

#[derive(Accounts)]
pub struct InitializeBridge<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + BridgeConfig::INIT_SPACE,
        seeds = [b"bridge_config"],
        bump,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ModifyBridgeOwners<'info> {
    #[account(
        mut,
        seeds = [b"bridge_config"],
        bump = bridge_config.bump,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    pub caller: Signer<'info>,
}

/// Shared context for add_manager / remove_manager — caller must be primary_owner
#[derive(Accounts)]
pub struct ModifyManagers<'info> {
    #[account(
        mut,
        seeds = [b"bridge_config"],
        bump = bridge_config.bump,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    pub caller: Signer<'info>,
}

#[derive(Accounts)]
pub struct ReactivateBridgeableToken<'info> {
    #[account(
        seeds = [b"bridge_config"],
        bump = bridge_config.bump,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"bridgeable_token", mint.key().as_ref()],
        bump = bridgeable_token.bump,
    )]
    pub bridgeable_token: Account<'info, BridgeableToken>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct AddBridgeableToken<'info> {
    #[account(
        seeds = [b"bridge_config"],
        bump = bridge_config.bump,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = owner,
        space = 8 + BridgeableToken::INIT_SPACE,
        seeds = [b"bridgeable_token", mint.key().as_ref()],
        bump,
    )]
    pub bridgeable_token: Account<'info, BridgeableToken>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveBridgeableToken<'info> {
    #[account(
        seeds = [b"bridge_config"],
        bump = bridge_config.bump,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"bridgeable_token", mint.key().as_ref()],
        bump = bridgeable_token.bump,
    )]
    pub bridgeable_token: Account<'info, BridgeableToken>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct BridgeToken<'info> {
    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"token_info", mint.key().as_ref()],
        bump = token_info.bump,
        has_one = mint,
    )]
    pub token_info: Account<'info, TokenInfo>,

    #[account(
        seeds = [b"bridgeable_token", mint.key().as_ref()],
        bump = bridgeable_token.bump,
    )]
    pub bridgeable_token: Account<'info, BridgeableToken>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = user,
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// CHECK: PDA that owns the vault ATA
    #[account(
        seeds = [b"vault", mint.key().as_ref()],
        bump,
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReturnTokenToUser<'info> {
    #[account(
        seeds = [b"bridge_config"],
        bump = bridge_config.bump,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = vault_authority,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// CHECK: PDA that owns the vault ATA
    #[account(
        seeds = [b"vault", mint.key().as_ref()],
        bump,
    )]
    pub vault_authority: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = bridge_owner,
        associated_token::mint = mint,
        associated_token::authority = recipient,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    /// CHECK: any valid recipient public key
    pub recipient: AccountInfo<'info>,

    #[account(mut)]
    pub bridge_owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransferBridgeOwnership<'info> {
    #[account(
        mut,
        seeds = [b"bridge_config"],
        bump = bridge_config.bump,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    pub current_owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct BurnTokens<'info> {
    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"token_info", mint.key().as_ref()],
        bump = token_info.bump,
        has_one = mint,
    )]
    pub token_info: Account<'info, TokenInfo>,

    #[account(mut)]
    pub from_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(name: String, symbol: String, uri: String, decimals: u8)]
pub struct CreateTokenWithMetadata<'info> {
    #[account(
        init,
        payer = creator,
        mint::decimals = decimals,
        mint::authority = token_info,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        space = 8 + TokenInfo::INIT_SPACE,
        seeds = [b"token_info", mint.key().as_ref()],
        bump
    )]
    pub token_info: Account<'info, TokenInfo>,

    /// CHECK: metaplex seeds checked in CPI
    #[account(
        mut,
        seeds = [
            b"metadata",
            metadata_program.key().as_ref(),
            mint.key().as_ref(),
        ],
        bump,
        seeds::program = metadata_program.key(),
    )]
    pub metadata_account: UncheckedAccount<'info>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct UpdateMetadata<'info> {
    #[account(
        mut,
        seeds = [b"token_info", mint.key().as_ref()],
        bump = token_info.bump,
        has_one = mint,
        has_one = creator,
    )]
    pub token_info: Account<'info, TokenInfo>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [
            b"metadata",
            metadata_program.key().as_ref(),
            mint.key().as_ref(),
        ],
        bump,
        seeds::program = metadata_program.key(),
    )]
    pub metadata_account: Account<'info, MetadataAccount>,

    pub metadata_program: Program<'info, Metadata>,
}

#[derive(Accounts)]
#[instruction(name: String, symbol: String, uri: String, decimals: u8)]
pub struct CreateToken<'info> {
    #[account(
        init,
        payer = creator,
        mint::decimals = decimals,
        mint::authority = token_info,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        space = 8 + TokenInfo::INIT_SPACE,
        seeds = [b"token_info", mint.key().as_ref()],
        bump
    )]
    pub token_info: Account<'info, TokenInfo>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintTokens<'info> {
    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"token_info", mint.key().as_ref()],
        bump = token_info.bump,
        has_one = mint,
    )]
    pub token_info: Account<'info, TokenInfo>,

    #[account(
        init_if_needed,
        payer = minter,
        associated_token::mint = mint,
        associated_token::authority = recipient,
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,

    /// CHECK: any recipient
    pub recipient: AccountInfo<'info>,

    #[account(mut)]
    pub minter: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BatchMintTokens<'info> {
    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"token_info", mint.key().as_ref()],
        bump = token_info.bump,
        has_one = mint,
    )]
    pub token_info: Account<'info, TokenInfo>,

    #[account(mut)]
    pub minter: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ToggleTokenStatus<'info> {
    #[account(
        mut,
        seeds = [b"token_info", mint.key().as_ref()],
        bump = token_info.bump,
        has_one = mint,
        has_one = creator,
    )]
    pub token_info: Account<'info, TokenInfo>,

    pub mint: Account<'info, Mint>,

    pub creator: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateTokenMetadata<'info> {
    #[account(
        mut,
        seeds = [b"token_info", mint.key().as_ref()],
        bump = token_info.bump,
        has_one = mint,
        has_one = creator,
    )]
    pub token_info: Account<'info, TokenInfo>,

    pub mint: Account<'info, Mint>,

    pub creator: Signer<'info>,
}

/* ================================================================
   STATE
   ================================================================ */

#[account]
#[derive(InitSpace)]
pub struct TokenInfo {
    pub creator: Pubkey,
    pub mint: Pubkey,
    #[max_len(32)]
    pub name: String,
    #[max_len(10)]
    pub symbol: String,
    #[max_len(200)]
    pub uri: String,
    pub decimals: u8,
    pub total_minted: u64,
    pub is_active: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BridgeConfig {
    pub primary_owner: Pubkey,
    /// up to 10 owners: 4 (vec len) + 10 * 32
    #[max_len(10)]
    pub owners: Vec<Pubkey>,
    /// up to 20 managers: 4 (vec len) + 20 * 32
    #[max_len(20)]
    pub managers: Vec<Pubkey>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct BridgeableToken {
    pub mint: Pubkey,
    #[max_len(64)]
    pub label: String,
    pub is_active: bool,
    pub bump: u8,
}

/* ================================================================
   EVENTS
   ================================================================ */

#[event]
pub struct TokenCreatedEvent {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub name: String,
    pub symbol: String,
    pub decimals: u8,
}

#[event]
pub struct TokensMintedEvent {
    pub mint: Pubkey,
    pub minter: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct BridgeInitiatedEvent {
    pub sender: Pubkey,
    pub mint: Pubkey,
    pub token_name: String,
    pub token_symbol: String,
    pub decimals: u8,
    pub amount: u64,
    pub receiver_on_sepolia: [u8; 20],
    pub timestamp: u64,
}

#[event]
pub struct TokensReturnedEvent {
    pub receiver: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub timestamp: u64,
}

/* ================================================================
   ERRORS
   ================================================================ */

#[error_code]
pub enum ErrorCode {
    #[msg("Token name is too long (max 32 characters)")]
    NameTooLong,
    #[msg("Token symbol is too long (max 10 characters)")]
    SymbolTooLong,
    #[msg("URI is too long (max 200 characters)")]
    UriTooLong,
    #[msg("Token is inactive")]
    TokenInactive,
    #[msg("Invalid amount (must be greater than 0)")]
    InvalidAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Batch is empty")]
    EmptyBatch,
    #[msg("Batch too large (max 10 recipients)")]
    BatchTooLarge,
    #[msg("Token is not whitelisted for bridging")]
    TokenNotBridgeable,
    #[msg("Label is too long (max 64 characters)")]
    LabelTooLong,
    #[msg("Address is already an owner")]
    AlreadyAnOwner,
    #[msg("Owner not found")]
    OwnerNotFound,
    #[msg("Cannot remove the primary owner")]
    CannotRemovePrimaryOwner,
    #[msg("Too many owners (max 10)")]
    TooManyOwners,
    #[msg("Address is already a manager")]
    AlreadyAManager,
    #[msg("Manager not found")]
    ManagerNotFound,
    #[msg("Too many managers (max 20)")]
    TooManyManagers,
}
