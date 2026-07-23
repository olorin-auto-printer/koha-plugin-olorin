package Koha::Plugin::Com::OlorinAutoPrinter::Olorin;

# Copyright 2026 Kyle M Hall
#
# This program is free software; you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation; either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, see <http://www.gnu.org/licenses>.

use Modern::Perl;

use base qw(Koha::Plugins::Base);

use Mojo::JSON qw(decode_json encode_json);

our $VERSION = "1.0.0";

our $metadata = {
    name            => 'Olorin silent printing',
    author          => 'Kyle M Hall',
    description     => 'Silent printing of Koha slips, receipts, and labels through the Olorin Companion App — no notice template editing required',
    date_authored   => '2026-07-23',
    date_updated    => '2026-07-23',
    minimum_version => '24.05.00.000',
    maximum_version => undef,
    version         => $VERSION,
    namespace       => 'olorin',
};

# The five logical printers the Olorin companion app maps to real devices,
# per workstation
our $PRINTER_KEYS = [ 'receipt_printer', 'sticker_printer', 'paper_printer', 'full_sheet_printer', 'label_printer' ];

our $MODES = [ 'off', 'manual', 'auto' ];

# Single source of truth for every slip page the plugin can manage. Order
# matters: the browser controller takes the first match, so the specific
# printslip.pl entries must come before the patron_custom catch-all.
# 'params' values of "*" match any value of that query parameter.
our $SLIP_TYPES = [
    {
        key             => 'issueqslip',
        label           => 'Quick checkout slip (ISSUEQSLIP)',
        path            => '/members/printslip.pl',
        params          => { print => 'issueqslip' },
        container       => '#receipt',
        default_printer => 'receipt_printer',
    },
    {
        key             => 'issueslip',
        label           => 'Checkout slip (ISSUESLIP)',
        path            => '/members/printslip.pl',
        params          => { print => 'issueslip' },
        container       => '#receipt',
        default_printer => 'receipt_printer',
    },
    {
        key             => 'checkinslip',
        label           => 'Checkin slip (CHECKINSLIP)',
        path            => '/members/printslip.pl',
        params          => { print => 'checkinslip' },
        container       => '#receipt',
        default_printer => 'receipt_printer',
    },
    {
        key             => 'patron_custom',
        label           => 'Custom patron slips (any other code)',
        path            => '/members/printslip.pl',
        params          => { print => '*' },
        container       => '#receipt',
        default_printer => 'receipt_printer',
    },
    {
        key             => 'transfer',
        label           => 'Transfer slip',
        path            => '/circ/transfer-slip.pl',
        params          => {},
        container       => '#receipt',
        default_printer => 'receipt_printer',
    },
    {
        key             => 'hold_transfer',
        label           => 'Hold transfer slip',
        path            => '/circ/hold-transfer-slip.pl',
        params          => {},
        container       => '#receipt',
        default_printer => 'receipt_printer',
    },
    {
        key             => 'article_request',
        label           => 'Article request slip',
        path            => '/circ/article-request-slip.pl',
        params          => {},
        container       => '#receipt',
        default_printer => 'receipt_printer',
    },
    {
        key             => 'recall',
        label           => 'Recall pickup slip',
        path            => '/recalls/recall_pickup_slip.pl',
        params          => {},
        container       => '#receipt',
        default_printer => 'receipt_printer',
    },
    {
        key             => 'overdues',
        label           => 'Overdues slip',
        path            => '/members/print_overdues.pl',
        params          => {},
        container       => '#receipt',
        default_printer => 'paper_printer',
    },
    {
        key             => 'pos_receipt',
        label           => 'Point of sale receipt / payout',
        path            => '/pos/printreceipt.pl',
        params          => {},
        container       => '#receipt',
        default_printer => 'receipt_printer',
        supports_drawer => 1,
    },
    {
        key             => 'fee_receipt',
        label           => 'Fee payment receipt',
        path            => '/members/printfeercpt.pl',
        params          => {},
        container       => '#receipt',
        default_printer => 'receipt_printer',
    },
    {
        key             => 'invoice',
        label           => 'Fee invoice',
        path            => '/members/printinvoice.pl',
        params          => {},
        container       => '#receipt',
        default_printer => 'receipt_printer',
    },
    {
        key             => 'notice',
        label           => 'Patron notice reprint',
        path            => '/members/printnotice.pl',
        params          => {},
        container       => '#slip',
        default_printer => 'paper_printer',
    },
    {
        key             => 'summary',
        label           => 'Patron summary',
        path            => '/members/summary-print.pl',
        params          => {},
        container       => '#main',
        default_printer => 'paper_printer',
    },
    {
        key             => 'preservation',
        label           => 'Preservation slips',
        path            => '/preservation/print_slip.pl',
        params          => {},
        container       => '#receipt',
        default_printer => 'receipt_printer',
    },
    {
        key             => 'spinelabel',
        label           => 'Spine label',
        path            => '/labels/spinelabel-print.pl',
        params          => {},
        container       => '#spinelabel',
        default_printer => 'label_printer',
        manual_triggers => ['.print-label'],
        no_auto_close   => 1,
    },
];

my $CONFIG_SCHEMA_VERSION = 1;

=head3 new

=cut

sub new {
    my ( $class, $args ) = @_;

    $args->{'metadata'} = $metadata;
    $args->{'metadata'}->{'class'} = $class;

    my $self = $class->SUPER::new($args);

    return $self;
}

=head3 install

Seeds the default configuration. Everything defaults to off, so installing
the plugin changes no behavior until it is configured.

=cut

sub install {
    my ($self) = @_;

    $self->store_data( { configuration => encode_json( $self->default_config ) } )
        unless $self->retrieve_data('configuration');

    return 1;
}

=head3 upgrade

Additive migration: new slip types gain default settings, existing settings
are never discarded.

=cut

sub upgrade {
    my ($self) = @_;

    my $config = $self->get_config;
    $config->{schema_version} = $CONFIG_SCHEMA_VERSION;
    $self->store_data( { configuration => encode_json($config) } );

    return 1;
}

=head3 uninstall

=cut

sub uninstall {
    my ($self) = @_;
    return 1;
}

=head3 api_namespace

=cut

sub api_namespace {
    return 'olorin';
}

=head3 static_routes

=cut

sub static_routes {
    my ( $self, $args ) = @_;
    return decode_json( $self->mbf_read('staticapi.json') );
}

=head3 slip_types

Returns the ordered slip-type registry.

=cut

sub slip_types {
    return $SLIP_TYPES;
}

=head3 default_config

Builds the all-off default configuration from the registry.

=cut

sub default_config {
    my ($class) = @_;

    my $types = {};
    for my $type (@$SLIP_TYPES) {
        $types->{ $type->{key} } = {
            mode       => 'off',
            printer    => $type->{default_printer},
            auto_close => $type->{no_auto_close} ? Mojo::JSON->false : Mojo::JSON->true,
            $type->{supports_drawer} ? ( kick_drawer => Mojo::JSON->false ) : (),
        };
    }

    return {
        schema_version => $CONFIG_SCHEMA_VERSION,
        close_delay_ms => 350,
        types          => $types,
    };
}

=head3 get_config

Returns the stored configuration merged over defaults, so configurations
saved by older plugin versions pick up new slip types automatically.

=cut

sub get_config {
    my ($self) = @_;

    my $config = $self->default_config;

    my $stored_json = $self->retrieve_data('configuration');
    return $config unless $stored_json;

    my $stored = eval { decode_json($stored_json) };
    return $config unless ref $stored eq 'HASH';

    $config->{close_delay_ms} = 0 + $stored->{close_delay_ms}
        if defined $stored->{close_delay_ms} && $stored->{close_delay_ms} =~ /^\d+$/;

    for my $key ( keys %{ $config->{types} } ) {
        my $stored_type = $stored->{types}->{$key};
        next unless ref $stored_type eq 'HASH';
        my $type = $config->{types}->{$key};

        $type->{mode} = $stored_type->{mode}
            if defined $stored_type->{mode} && grep { $_ eq $stored_type->{mode} } @$MODES;
        $type->{printer} = $stored_type->{printer}
            if defined $stored_type->{printer} && grep { $_ eq $stored_type->{printer} } @$PRINTER_KEYS;
        $type->{auto_close} = $stored_type->{auto_close} ? Mojo::JSON->true : Mojo::JSON->false
            if defined $stored_type->{auto_close};
        $type->{kick_drawer} = $stored_type->{kick_drawer} ? Mojo::JSON->true : Mojo::JSON->false
            if exists $type->{kick_drawer} && defined $stored_type->{kick_drawer};
    }

    return $config;
}

=head3 save_config

Validates and stores a configuration hashref. Invalid values are ignored in
favor of the current (or default) value for that field.

=cut

sub save_config {
    my ( $self, $incoming ) = @_;

    my $config = $self->get_config;

    $config->{close_delay_ms} = 0 + $incoming->{close_delay_ms}
        if defined $incoming->{close_delay_ms}
        && $incoming->{close_delay_ms} =~ /^\d+$/
        && $incoming->{close_delay_ms} <= 10000;

    for my $key ( keys %{ $config->{types} } ) {
        my $incoming_type = $incoming->{types}->{$key};
        next unless ref $incoming_type eq 'HASH';
        my $type = $config->{types}->{$key};

        $type->{mode} = $incoming_type->{mode}
            if defined $incoming_type->{mode} && grep { $_ eq $incoming_type->{mode} } @$MODES;
        $type->{printer} = $incoming_type->{printer}
            if defined $incoming_type->{printer} && grep { $_ eq $incoming_type->{printer} } @$PRINTER_KEYS;
        $type->{auto_close} = $incoming_type->{auto_close} ? Mojo::JSON->true : Mojo::JSON->false;
        $type->{kick_drawer} = $incoming_type->{kick_drawer} ? Mojo::JSON->true : Mojo::JSON->false
            if exists $type->{kick_drawer};
    }

    $self->store_data( { configuration => encode_json($config) } );

    return $config;
}

=head3 intranet_head

Injects the Olorin config stanza and the deferred client scripts on every
staff page. Returns an empty string when no slip type is enabled, so an
unconfigured plugin adds nothing to any page.

=cut

sub intranet_head {
    my ($self) = @_;

    my $config = $self->get_config;

    my $any_enabled = grep { $_->{mode} ne 'off' } values %{ $config->{types} };
    return q{} unless $any_enabled;

    my $client_config = $self->_client_config($config);
    my $json          = _escape_json_for_html( encode_json($client_config) );

    my $olorin_url = $self->_static_url('js/olorin.js');
    my $koha_url   = $self->_static_url('js/olorin-koha.js');

    return qq{<!-- koha-plugin-olorin v$VERSION -->
<script type="application/json" id="olorin-config">$json</script>
<script defer src="$olorin_url"></script>
<script defer src="$koha_url"></script>
};
}

=head3 configure

Renders the configuration page, and saves it on POST with op=cud-save.

=cut

sub configure {
    my ( $self, $args ) = @_;
    my $cgi = $self->{'cgi'};

    my $op = $cgi->param('op') || q{};

    if ( $op eq 'cud-save' ) {
        my $incoming = { close_delay_ms => scalar $cgi->param('close_delay_ms'), types => {} };

        for my $type (@$SLIP_TYPES) {
            my $key = $type->{key};
            $incoming->{types}->{$key} = {
                mode        => scalar $cgi->param("mode_$key"),
                printer     => scalar $cgi->param("printer_$key"),
                auto_close  => scalar $cgi->param("auto_close_$key") ? 1 : 0,
                kick_drawer => scalar $cgi->param("kick_drawer_$key") ? 1 : 0,
            };
        }

        $self->save_config($incoming);

        print $cgi->redirect( "/cgi-bin/koha/plugins/run.pl?class="
                . $self->{'class'}
                . "&method=configure&saved=1" );
        return;
    }

    my $template = $self->get_template( { file => 'configure.tt' } );

    $template->param(
        config       => $self->get_config,
        slip_types   => $self->slip_types,
        printer_keys => $PRINTER_KEYS,
        olorin_js    => $self->_static_url('js/olorin.js'),
        saved        => scalar $cgi->param('saved') ? 1 : 0,
        plugin_version => $VERSION,
    );

    $self->output_html( $template->output );
}

sub _client_config {
    my ( $self, $config ) = @_;

    my @types;
    for my $type (@$SLIP_TYPES) {
        my $settings = $config->{types}->{ $type->{key} };
        push @types, {
            key       => $type->{key},
            path      => $type->{path},
            params    => $type->{params},
            container => $type->{container},
            $type->{manual_triggers} ? ( manual_triggers => $type->{manual_triggers} ) : (),
            mode        => $settings->{mode},
            printer     => $settings->{printer},
            auto_close  => $settings->{auto_close},
            $type->{supports_drawer} ? ( kick_drawer => $settings->{kick_drawer} ) : (),
        };
    }

    return {
        version        => $VERSION,
        close_delay_ms => $config->{close_delay_ms},
        types          => \@types,
    };
}

sub _static_url {
    my ( $self, $file ) = @_;
    return "/api/v1/contrib/" . $self->api_namespace . "/static/$file?v=$VERSION";
}

sub _escape_json_for_html {
    my ($json) = @_;
    $json =~ s{</}{<\\/}g;
    return $json;
}

1;
